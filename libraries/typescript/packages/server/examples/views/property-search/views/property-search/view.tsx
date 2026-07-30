/**
 * HomeScout SF — a Zillow-style property search that the assistant re-searches
 * in place.
 *
 * `search-homes` opens this view once with the whole staged catalog. From then
 * on the assistant drives it through the ephemeral view tools registered
 * below: "search homes in SoMa" hits `search-in-view`, which re-filters the
 * cards and flies the Leaflet map, all inside the same iframe. No second view
 * is ever rendered.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  ModelContext,
  ThemeProvider,
  useCallTool,
  useDisplayMode,
  useSendFollowUp,
  useToolContext,
  useViewTheme,
  useViewTool,
  type ViewConfig,
} from "mcp-use/react";

import { DetailSheet, ListingCard, type ListingDetails } from "./cards.js";
import {
  ALL_AREAS,
  AREA_NAMES,
  NO_FILTERS,
  areaChoiceSchema,
  compactPrice,
  describeFilters,
  homeTypeSchema,
  selectListings,
  sortSchema,
  type Area,
  type AreaMeta,
  type Filters,
  type HomeType,
  type Listing,
  type Sort,
} from "./catalog.js";
import { PropertyMap, type MapHandle } from "./map.js";

import "./view.css";

export const viewConfig: ViewConfig = {
  autoResize: true,
  displayModes: ["inline", "fullscreen"],
};

/* ------------------------------------------------------------------ */
/* View tool definitions                                              */
/* ------------------------------------------------------------------ */

const oneSentenceResponse =
  "After calling this tool, respond to the user with exactly one sentence.";

const searchInViewDefinition = {
  name: "search-in-view",
  title: "Search homes in the open map",
  description: [
    "Run a new home search **inside the already-open HomeScout map**. This is the tool for every follow-up search once the view is on screen — 'search homes in SoMa', 'now show the Mission', 'only houses under $2M', 'anything with 3+ bedrooms'.",
    "The map flies to the area and the result cards re-filter in place. Do not call `search-homes` again while this view is open; that renders a redundant second view.",
    "Omitted fields keep their current value, so you can narrow step by step. Changing `area` clears any previously removed homes. Pass `clearFilters: true` to start from an unfiltered search of the area.",
    oneSentenceResponse,
  ].join(" "),
  inputSchema: z.object({
    area: areaChoiceSchema
      .optional()
      .describe(
        "Neighborhood to search; 'All San Francisco' searches the whole city"
      ),
    maxPrice: z.number().positive().optional().describe("Upper price bound"),
    minPrice: z.number().positive().optional().describe("Lower price bound"),
    minBeds: z.number().int().min(0).max(6).optional(),
    minBaths: z.number().min(0).max(5).optional(),
    homeType: homeTypeSchema
      .optional()
      .describe("'Any' clears an existing home-type filter"),
    sort: sortSchema.optional(),
    clearFilters: z
      .boolean()
      .optional()
      .describe("Drop current price/bed/bath/type filters before applying"),
  }),
  outputSchema: z.object({
    area: z.string(),
    filters: z.string(),
    sort: sortSchema,
    visibleCount: z.number(),
    visibleIds: z.array(z.string()),
    priceRange: z.string(),
  }),
} as const;

const removeListingsDefinition = {
  name: "remove-listings",
  title: "Remove homes from the live results",
  description: `Remove one or more visible homes from both the cards and the map when the user asks to hide them; removals survive filter changes but are cleared by a new area search. ${oneSentenceResponse}`,
  inputSchema: z.object({
    ids: z.array(z.string()).min(1).describe("Visible listing IDs to remove"),
    reason: z.string().optional(),
  }),
  outputSchema: z.object({
    removedIds: z.array(z.string()),
    remainingCount: z.number(),
  }),
} as const;

const selectListingDefinition = {
  name: "select-listing",
  title: "Open a home on the map",
  description: `Highlight one visible home, fly the map to its pin, and open its detail card. ${oneSentenceResponse}`,
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ selectedId: z.string(), address: z.string() }),
} as const;

const saveListingsDefinition = {
  name: "save-listings",
  title: "Save or unsave homes",
  description: `Add visible homes to or remove them from the saved list, which shows a filled heart on the card and map pin. ${oneSentenceResponse}`,
  inputSchema: z.object({
    ids: z.array(z.string()).min(1),
    saved: z.boolean().optional().describe("Defaults to true"),
  }),
  outputSchema: z.object({ savedIds: z.array(z.string()) }),
} as const;

const fitResultsDefinition = {
  name: "fit-visible-results",
  title: "Fit the map to visible results",
  description: `Reset the map camera so every currently visible home is in frame. ${oneSentenceResponse}`,
  inputSchema: z.object({}),
  outputSchema: z.object({ visibleCount: z.number() }),
} as const;

const zoomMapDefinition = {
  name: "zoom-map",
  title: "Zoom the map",
  description: `Zoom the live map in or out by whole steps. ${oneSentenceResponse}`,
  inputSchema: z.object({
    direction: z.enum(["in", "out"]),
    steps: z.number().int().min(1).max(4).optional().describe("Defaults to 1"),
  }),
  outputSchema: z.object({ zoom: z.number() }),
} as const;

const panMapDefinition = {
  name: "pan-map",
  title: "Pan the map",
  description: `Slide the live map one compass direction. ${oneSentenceResponse}`,
  inputSchema: z.object({
    direction: z.enum(["north", "south", "east", "west"]),
    amount: z.enum(["a little", "some", "a lot"]).optional(),
  }),
  outputSchema: z.object({ direction: z.string() }),
} as const;

/* ------------------------------------------------------------------ */
/* View                                                               */
/* ------------------------------------------------------------------ */

const PAN_FRACTIONS: Record<"a little" | "some" | "a lot", number> = {
  "a little": 0.2,
  some: 0.45,
  "a lot": 0.8,
};

const PRICE_CAPS = [1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000];

/** Transient banner naming the last assistant-driven change to the view. */
interface Pulse {
  label: string;
  detail: string;
  seq: number;
}

function priceRangeLabel(listings: readonly Listing[]): string {
  if (listings.length === 0) return "—";
  const prices = listings.map((listing) => listing.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high
    ? compactPrice(low)
    : `${compactPrice(low)} – ${compactPrice(high)}`;
}

function HomeScout(): React.JSX.Element {
  const view = useToolContext<"search-homes">();
  const theme = useViewTheme();
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  const sendFollowUp = useSendFollowUp();
  const detailsTool = useCallTool("get-listing-details");
  const mapRef = useRef<MapHandle | null>(null);

  const [filters, setFilters] = useState<Filters | null>(null);
  const [sort, setSort] = useState<Sort>("Recommended");
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const pulseSeq = useRef(0);

  const catalog = view.status === "ready" ? view.toolOutput.catalog : null;
  const listings = catalog?.listings ?? [];
  const areaMeta = catalog?.areas ?? [];

  // The opening tool call seeds the filter; every later change is local state.
  const effectiveFilters: Filters =
    filters ??
    (view.status === "ready"
      ? { ...NO_FILTERS, area: view.toolOutput.area }
      : NO_FILTERS);

  const visible = useMemo(
    () => selectListings(listings, effectiveFilters, removedIds, sort),
    [listings, effectiveFilters, removedIds, sort]
  );
  const activeArea: AreaMeta | null =
    areaMeta.find((entry) => entry.name === effectiveFilters.area) ?? null;
  const selected = visible.find((listing) => listing.id === selectedId) ?? null;

  const flash = (label: string, detail: string) => {
    pulseSeq.current += 1;
    setPulse({ label, detail, seq: pulseSeq.current });
  };

  useEffect(() => {
    if (pulse === null) return;
    const timer = setTimeout(() => {
      setPulse((current) => (current?.seq === pulse.seq ? null : current));
    }, 4200);
    return () => clearTimeout(timer);
  }, [pulse]);

  // Frame the opening result once — later camera moves are driven by the view
  // tools and the UI, never by re-render.
  const framedRef = useRef(false);
  useEffect(() => {
    if (framedRef.current || catalog === null) return;
    framedRef.current = true;
    if (activeArea !== null) {
      mapRef.current?.flyToArea(activeArea);
    } else {
      mapRef.current?.fitTo(visible);
    }
  }, [catalog, activeArea, visible]);

  const openListing = (id: string, fly: boolean) => {
    setSelectedId(id);
    const listing = listings.find((candidate) => candidate.id === id);
    if (fly && listing !== undefined) mapRef.current?.flyToListing(listing);
    void detailsTool.callTool({ id });
  };

  const applySearch = (
    next: Filters,
    options: { resetRemoved: boolean; nextSort?: Sort }
  ): Listing[] => {
    const nextSort = options.nextSort ?? sort;
    const nextRemoved = options.resetRemoved ? [] : removedIds;
    const nextVisible = selectListings(listings, next, nextRemoved, nextSort);
    setFilters(next);
    if (options.nextSort !== undefined) setSort(options.nextSort);
    if (options.resetRemoved) setRemovedIds([]);
    setSelectedId(null);
    const target = areaMeta.find((entry) => entry.name === next.area) ?? null;
    if (target !== null) {
      mapRef.current?.flyToArea(target);
    } else {
      mapRef.current?.fitTo(nextVisible);
    }
    return nextVisible;
  };

  /* ---------------- view tools ---------------- */

  useViewTool<typeof searchInViewDefinition>(
    searchInViewDefinition,
    async (args) => {
      const base =
        args.clearFilters === true
          ? { ...NO_FILTERS, area: effectiveFilters.area }
          : effectiveFilters;
      const areaChanged =
        args.area !== undefined &&
        (args.area === ALL_AREAS ? null : args.area) !== base.area;
      const next: Filters = {
        area:
          args.area === undefined
            ? base.area
            : args.area === ALL_AREAS
              ? null
              : args.area,
        maxPrice: args.maxPrice ?? base.maxPrice,
        minPrice: args.minPrice ?? base.minPrice,
        minBeds: args.minBeds ?? base.minBeds,
        minBaths: args.minBaths ?? base.minBaths,
        homeType:
          args.homeType === undefined
            ? base.homeType
            : args.homeType === "Any"
              ? null
              : args.homeType,
      };
      const nextVisible = applySearch(next, {
        resetRemoved: areaChanged || args.clearFilters === true,
        ...(args.sort === undefined ? {} : { nextSort: args.sort }),
      });
      const areaLabel = next.area ?? ALL_AREAS;
      flash(
        `Searched ${areaLabel}`,
        `${nextVisible.length} home${nextVisible.length === 1 ? "" : "s"} · ${describeFilters(next)}`
      );
      return {
        content: [
          {
            type: "text",
            text:
              nextVisible.length === 0
                ? `No staged homes in ${areaLabel} match ${describeFilters(next)}. The map is still open — loosen a filter or try another neighborhood with this same tool.`
                : `Updated the open map in place: ${nextVisible.length} home${nextVisible.length === 1 ? "" : "s"} in ${areaLabel} (${describeFilters(next)}), ${priceRangeLabel(nextVisible)}, sorted by ${args.sort ?? sort}.`,
          },
        ],
        structuredContent: {
          area: areaLabel,
          filters: describeFilters(next),
          sort: args.sort ?? sort,
          visibleCount: nextVisible.length,
          visibleIds: nextVisible.map((listing) => listing.id),
          priceRange: priceRangeLabel(nextVisible),
        },
      };
    }
  );

  useViewTool<typeof removeListingsDefinition>(
    removeListingsDefinition,
    async ({ ids, reason }) => {
      const visibleIds = new Set(visible.map((listing) => listing.id));
      const removed = ids.filter((id) => visibleIds.has(id));
      if (removed.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `None of those IDs are visible right now; visible IDs are ${visible.map((listing) => listing.id).join(", ") || "none"}.`,
            },
          ],
        };
      }
      const nextRemoved = [...new Set([...removedIds, ...removed])];
      setRemovedIds(nextRemoved);
      if (selectedId !== null && removed.includes(selectedId)) {
        setSelectedId(null);
      }
      const remaining = visible.length - removed.length;
      flash(
        `Removed ${removed.length} home${removed.length === 1 ? "" : "s"}`,
        reason ?? `${remaining} still visible`
      );
      return {
        content: [
          {
            type: "text",
            text: `Removed ${removed.length} home${removed.length === 1 ? "" : "s"} from the live cards and map${reason === undefined ? "" : ` (${reason})`}, leaving ${remaining} visible.`,
          },
        ],
        structuredContent: { removedIds: removed, remainingCount: remaining },
      };
    }
  );

  useViewTool<typeof selectListingDefinition>(
    selectListingDefinition,
    async ({ id }) => {
      const listing = visible.find((candidate) => candidate.id === id);
      if (listing === undefined) {
        return {
          isError: true,
          content: [
            { type: "text", text: `${id} is not a visible listing right now.` },
          ],
        };
      }
      openListing(id, true);
      flash(
        "Opened a home",
        `${listing.address} · ${compactPrice(listing.price)}`
      );
      return {
        content: [
          {
            type: "text",
            text: `Flew the map to ${listing.address} and opened its detail card.`,
          },
        ],
        structuredContent: { selectedId: id, address: listing.address },
      };
    }
  );

  useViewTool<typeof saveListingsDefinition>(
    saveListingsDefinition,
    async ({ ids, saved = true }) => {
      const visibleIds = new Set(visible.map((listing) => listing.id));
      const touched = ids.filter((id) => visibleIds.has(id));
      const next = saved
        ? [...new Set([...savedIds, ...touched])]
        : savedIds.filter((id) => !touched.includes(id));
      setSavedIds(next);
      flash(
        saved ? "Saved homes" : "Unsaved homes",
        `${next.length} in the saved list`
      );
      return {
        content: [
          {
            type: "text",
            text: `${saved ? "Saved" : "Unsaved"} ${touched.length} home${touched.length === 1 ? "" : "s"}; ${next.length} in the saved list.`,
          },
        ],
        structuredContent: { savedIds: next },
      };
    }
  );

  useViewTool<typeof fitResultsDefinition>(fitResultsDefinition, async () => {
    mapRef.current?.fitTo(visible);
    flash(
      "Fit the map",
      `${visible.length} home${visible.length === 1 ? "" : "s"} in frame`
    );
    return {
      content: [
        {
          type: "text",
          text: `Fit the map around ${visible.length} visible home${visible.length === 1 ? "" : "s"}.`,
        },
      ],
      structuredContent: { visibleCount: visible.length },
    };
  });

  useViewTool<typeof zoomMapDefinition>(
    zoomMapDefinition,
    async ({ direction, steps = 1 }) => {
      mapRef.current?.zoomBy(direction === "in" ? steps : -steps);
      const zoom = mapRef.current?.zoom() ?? 0;
      flash(`Zoomed ${direction}`, `Level ${zoom.toFixed(1)}`);
      return {
        content: [
          {
            type: "text",
            text: `Zoomed ${direction} to level ${zoom.toFixed(1)}.`,
          },
        ],
        structuredContent: { zoom },
      };
    }
  );

  useViewTool<typeof panMapDefinition>(
    panMapDefinition,
    async ({ direction, amount = "some" }) => {
      mapRef.current?.pan(direction, PAN_FRACTIONS[amount]);
      flash(`Panned ${direction}`, amount);
      return {
        content: [
          {
            type: "text",
            text: `Panned the map ${amount} to the ${direction}.`,
          },
        ],
        structuredContent: { direction },
      };
    }
  );

  /* ---------------- render ---------------- */

  if (view.status === "error") {
    return (
      <div className="hs-app hs-boot">
        <p className="hs-boot-title">HomeScout could not open</p>
        <p className="hs-boot-note">{view.error.message}</p>
      </div>
    );
  }
  if (view.status === "pending" || catalog === null) {
    return (
      <div className="hs-app hs-boot">
        <span className="hs-logo" aria-hidden="true">
          ⌂
        </span>
        <p className="hs-boot-title">
          Mapping {view.toolInput?.location ?? "San Francisco"}…
        </p>
        <p className="hs-boot-note">Loading the staged catalog and basemap</p>
      </div>
    );
  }

  const areaLabel = effectiveFilters.area ?? ALL_AREAS;
  const isFullscreen = displayMode === "fullscreen";
  const canFullscreen = availableDisplayModes.includes("fullscreen");

  return (
    <div
      className={`hs-app${theme === "dark" ? " hs-dark" : ""}${isFullscreen ? " hs-full" : ""}`}
    >
      <ModelContext
        content={[
          `HomeScout map is OPEN. Use view tools (search-in-view, remove-listings, select-listing, save-listings, fit-visible-results, zoom-map, pan-map) for every follow-up — do not call search-homes again.`,
          `Area: ${areaLabel}. Filters: ${describeFilters(effectiveFilters)}. Sort: ${sort}. Display: ${displayMode}.`,
          `Visible (${visible.length}): ${
            visible
              .map(
                (listing) =>
                  `${listing.id} — ${listing.address}, ${listing.area}, ${compactPrice(listing.price)}, ${listing.beds}bd/${listing.baths}ba, ${listing.homeType}`
              )
              .join("; ") || "none"
          }.`,
          `Removed: ${removedIds.join(", ") || "none"}. Saved: ${savedIds.join(", ") || "none"}. Open card: ${selectedId ?? "none"}.`,
        ].join("\n")}
      />

      {isFullscreen && (
        <div className="hs-filters" role="group" aria-label="Filters">
          <select
            aria-label="Neighborhood"
            value={effectiveFilters.area ?? ALL_AREAS}
            onChange={(event) => {
              const value = event.target.value;
              applySearch(
                {
                  ...effectiveFilters,
                  area: value === ALL_AREAS ? null : (value as Area),
                },
                { resetRemoved: true }
              );
            }}
          >
            <option value={ALL_AREAS}>{ALL_AREAS}</option>
            {AREA_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            aria-label="Maximum price"
            value={effectiveFilters.maxPrice ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              applySearch(
                {
                  ...effectiveFilters,
                  maxPrice: raw === "" ? null : Number(raw),
                },
                { resetRemoved: false }
              );
            }}
          >
            <option value="">Any price</option>
            {PRICE_CAPS.map((cap) => (
              <option key={cap} value={cap}>
                Up to {compactPrice(cap)}
              </option>
            ))}
          </select>

          <select
            aria-label="Minimum bedrooms"
            value={effectiveFilters.minBeds}
            onChange={(event) =>
              applySearch(
                { ...effectiveFilters, minBeds: Number(event.target.value) },
                { resetRemoved: false }
              )
            }
          >
            <option value={0}>Any beds</option>
            {[1, 2, 3, 4].map((beds) => (
              <option key={beds} value={beds}>
                {beds}+ bd
              </option>
            ))}
          </select>

          <select
            aria-label="Home type"
            value={effectiveFilters.homeType ?? "Any"}
            onChange={(event) => {
              const value = event.target.value;
              applySearch(
                {
                  ...effectiveFilters,
                  homeType: value === "Any" ? null : (value as HomeType),
                },
                { resetRemoved: false }
              );
            }}
          >
            <option value="Any">Any type</option>
            {(
              ["House", "Condo", "Townhouse", "Loft", "Multi-family"] as const
            ).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          {savedIds.length > 0 && (
            <span className="hs-saved-count">♥ {savedIds.length} saved</span>
          )}
        </div>
      )}

      <main className="hs-workspace">
        <section className="hs-map" aria-label="Property map">
          <PropertyMap
            ref={mapRef}
            listings={visible}
            activeArea={activeArea}
            selectedId={selectedId}
            hoveredId={hoveredId}
            savedIds={savedIds}
            theme={theme === "dark" ? "dark" : "light"}
            attribution={catalog.attribution}
            onSelect={(id) => openListing(id, false)}
            onHover={setHoveredId}
          />

          {pulse !== null && (
            <div className="hs-pulse" role="status">
              <span className="hs-pulse-dot" aria-hidden="true" />
              <span className="hs-pulse-label">{pulse.label}</span>
              <span className="hs-pulse-detail">{pulse.detail}</span>
            </div>
          )}

          <div className="hs-map-controls">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => mapRef.current?.zoomBy(1)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => mapRef.current?.zoomBy(-1)}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Fit results"
              onClick={() => mapRef.current?.fitTo(visible)}
            >
              ⤢
            </button>
          </div>

          {!isFullscreen && canFullscreen && (
            <button
              type="button"
              className="hs-fullscreen-toggle"
              aria-label="Open HomeScout in fullscreen"
              title="Full screen"
              onClick={() =>
                void requestDisplayMode({
                  mode: "fullscreen",
                })
              }
            >
              <span aria-hidden="true">⛶</span>
            </button>
          )}

          {selected !== null && (
            <DetailSheet
              listing={selected}
              details={
                detailsTool.data?.structuredContent as
                  | ListingDetails
                  | undefined
              }
              saved={savedIds.includes(selected.id)}
              onClose={() => setSelectedId(null)}
              onToggleSave={() =>
                setSavedIds((current) =>
                  current.includes(selected.id)
                    ? current.filter((id) => id !== selected.id)
                    : [...current, selected.id]
                )
              }
              onAsk={() =>
                void sendFollowUp({
                  prompt: `Tell me more about ${selected.address} (${selected.id}) on my HomeScout map.`,
                })
              }
            />
          )}
        </section>

        {isFullscreen && (
          <section className="hs-results" aria-label="Results">
            <div className="hs-results-head">
              <div>
                <h1>{areaLabel}</h1>
                <p>
                  {activeArea?.tagline ??
                    "Staged listings across the whole city"}
                </p>
              </div>
              <div className="hs-results-meta">
                <strong>{visible.length}</strong>
                <span>
                  {visible.length === 1 ? "home" : "homes"} ·{" "}
                  {priceRangeLabel(visible)}
                </span>
              </div>
            </div>

            <div className="hs-results-toolbar">
              <span className="hs-filter-summary">
                {describeFilters(effectiveFilters)}
              </span>
              <label className="hs-sort">
                Sort
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  {sortSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="hs-cards">
              {visible.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  selected={selectedId === listing.id}
                  hovered={hoveredId === listing.id}
                  saved={savedIds.includes(listing.id)}
                  onSelect={() => openListing(listing.id, true)}
                  onHover={(hovering) =>
                    setHoveredId(hovering ? listing.id : null)
                  }
                  onToggleSave={() =>
                    setSavedIds((current) =>
                      current.includes(listing.id)
                        ? current.filter((id) => id !== listing.id)
                        : [...current, listing.id]
                    )
                  }
                />
              ))}
              {visible.length === 0 && (
                <div className="hs-empty">
                  <strong>No staged homes match</strong>
                  <p>
                    Nothing in {areaLabel} fits{" "}
                    {describeFilters(effectiveFilters)}.
                  </p>
                  <button
                    type="button"
                    className="hs-btn is-primary"
                    onClick={() =>
                      applySearch(
                        { ...NO_FILTERS, area: effectiveFilters.area },
                        { resetRemoved: true }
                      )
                    }
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>

            <footer className="hs-disclaimer">
              Fictional listings staged for this MCP Apps demo. Basemap ©
              OpenStreetMap contributors, tiles © CARTO.
            </footer>
          </section>
        )}
      </main>
    </div>
  );
}

export default function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <HomeScout />
    </ThemeProvider>
  );
}
