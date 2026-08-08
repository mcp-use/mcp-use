/**
 * Client-side catalog model: filtering, sorting, and display formatting.
 *
 * `search-homes` returns the **whole** staged catalog, not just the first
 * match, so every follow-up search runs here in the iframe — that is what lets
 * the assistant re-search the open map instead of rendering a second view.
 *
 * The listing shape is not redeclared: it is projected off the server tool's
 * `outputSchema` through `RegisteredTools`, so a server-side field change is a
 * compile error here rather than a silent drift.
 */
import type { RegisteredTools } from "mcp-use/react";
import { z } from "zod";

/** The staged catalog as `search-homes` returns it. */
export type Catalog = RegisteredTools["search-homes"]["output"]["catalog"];
/** A staged home with its real map coordinates. */
export type Listing = Catalog["listings"][number];
/** Map camera and copy for one staged neighborhood. */
export type AreaMeta = Catalog["areas"][number];
/** A staged San Francisco neighborhood. */
export type Area = Listing["area"];
/** One of the five staged property categories. */
export type HomeType = Listing["homeType"];

/**
 * Every staged area, in filter-rail order.
 *
 * Duplicated from the server because the view tools need the names as a
 * runtime Zod enum; {@link Area} still keeps the two lists type-compatible.
 */
export const AREA_NAMES = [
  "Pacific Heights",
  "Marina",
  "Russian Hill",
  "Nob Hill",
  "Hayes Valley",
  "SoMa",
  "Mission District",
  "Noe Valley",
  "Potrero Hill",
  "Bernal Heights",
] as const satisfies readonly Area[];

/** Sentinel the view tools accept to clear the neighborhood filter. */
export const ALL_AREAS = "All San Francisco";

/** Neighborhood choices for a view tool's `area` input. */
export const areaChoiceSchema = z.enum([ALL_AREAS, ...AREA_NAMES]);
/** Property categories a view tool may filter by. */
export const homeTypeSchema = z.enum([
  "Any",
  "House",
  "Condo",
  "Townhouse",
  "Loft",
  "Multi-family",
]) satisfies z.ZodType<"Any" | HomeType>;
/** Result orderings offered in the results header and to the view tools. */
export const sortSchema = z.enum([
  "Recommended",
  "Newest",
  "Price: low to high",
  "Price: high to low",
  "Largest",
  "$ / sqft",
]);

/** A result-ordering choice. */
export type Sort = z.infer<typeof sortSchema>;

/** The active result filter. `area: null` means all of San Francisco. */
export interface Filters {
  /** Neighborhood to restrict results to, or `null` for the whole city. */
  area: Area | null;
  /** Inclusive upper bound on list price, or `null` for no cap. */
  maxPrice: number | null;
  /** Inclusive lower bound on list price, or `null` for no floor. */
  minPrice: number | null;
  /** Minimum bedroom count. */
  minBeds: number;
  /** Minimum bathroom count. */
  minBaths: number;
  /** Property category to restrict results to, or `null` for any. */
  homeType: HomeType | null;
}

/** The empty filter — every catalog home matches. */
export const NO_FILTERS: Filters = {
  area: null,
  maxPrice: null,
  minPrice: null,
  minBeds: 0,
  minBaths: 0,
  homeType: null,
};

const featuredRank = (listing: Listing) =>
  listing.status === "Open house"
    ? 0
    : listing.status === "New"
      ? 1
      : listing.status === "For sale"
        ? 2
        : 3;

const comparators: Record<Sort, (a: Listing, b: Listing) => number> = {
  Recommended: (a, b) =>
    featuredRank(a) - featuredRank(b) || a.daysOnMarket - b.daysOnMarket,
  Newest: (a, b) => a.daysOnMarket - b.daysOnMarket,
  "Price: low to high": (a, b) => a.price - b.price,
  "Price: high to low": (a, b) => b.price - a.price,
  Largest: (a, b) => b.sqft - a.sqft,
  "$ / sqft": (a, b) => a.price / a.sqft - b.price / b.sqft,
};

/** Apply {@link Filters} and a removal set to the catalog, then sort. */
export function selectListings(
  catalog: readonly Listing[],
  filters: Filters,
  removedIds: readonly string[],
  sort: Sort
): Listing[] {
  const removed = new Set(removedIds);
  return catalog
    .filter(
      (listing) =>
        !removed.has(listing.id) &&
        (filters.area === null || listing.area === filters.area) &&
        (filters.maxPrice === null || listing.price <= filters.maxPrice) &&
        (filters.minPrice === null || listing.price >= filters.minPrice) &&
        listing.beds >= filters.minBeds &&
        listing.baths >= filters.minBaths &&
        (filters.homeType === null || listing.homeType === filters.homeType)
    )
    .sort(comparators[sort]);
}

/** Format a price the way a map pin does: `$1.25M`, `$875K`. */
export function compactPrice(price: number): string {
  if (price >= 1_000_000) {
    const millions = price / 1_000_000;
    return `$${millions.toFixed(millions >= 10 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  }
  return `$${Math.round(price / 1000)}K`;
}

/** Format a price in full, the way a listing card does: `$1,249,000`. */
export function fullPrice(price: number): string {
  return `$${price.toLocaleString("en-US")}`;
}

/** One-line summary of everything the filter narrows, excluding the area. */
export function describeFilters(filters: Filters): string {
  const parts: string[] = [];
  if (filters.minPrice !== null && filters.maxPrice !== null) {
    parts.push(
      `${compactPrice(filters.minPrice)}–${compactPrice(filters.maxPrice)}`
    );
  } else if (filters.maxPrice !== null) {
    parts.push(`under ${compactPrice(filters.maxPrice)}`);
  } else if (filters.minPrice !== null) {
    parts.push(`over ${compactPrice(filters.minPrice)}`);
  }
  if (filters.minBeds > 0) parts.push(`${filters.minBeds}+ bd`);
  if (filters.minBaths > 0) parts.push(`${filters.minBaths}+ ba`);
  if (filters.homeType !== null) parts.push(filters.homeType);
  return parts.length === 0 ? "no filters" : parts.join(" · ");
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const AREA_ALIASES: Partial<Record<Area, readonly string[]>> = {
  "Mission District": ["mission"],
  "Pacific Heights": ["pacheights", "pacifichts", "pachts"],
  SoMa: ["southofmarket", "soma", "rincon", "eastcut"],
  Marina: ["cowhollow"],
  "Noe Valley": ["noe"],
  "Potrero Hill": ["potrero", "dogpatch"],
  "Bernal Heights": ["bernal"],
  "Hayes Valley": ["hayes", "civiccenter"],
  "Russian Hill": ["northbeach"],
};

/**
 * Resolve free text like "the mission" or "soma" to a staged area.
 *
 * `null` means "all of San Francisco" and `undefined` means "no idea", so the
 * in-view search box can hand unrecognized places to the assistant instead of
 * silently showing the whole city.
 */
export function resolveArea(query: string): Area | null | undefined {
  const normalized = slug(query);
  if (normalized === "") return null;
  if (
    normalized.includes("sanfrancisco") ||
    normalized === "sf" ||
    normalized.includes("allsf") ||
    normalized.includes("everywhere")
  ) {
    return null;
  }
  return AREA_NAMES.find(
    (name) =>
      normalized.includes(slug(name)) ||
      (AREA_ALIASES[name]?.some((alias) => normalized.includes(alias)) ?? false)
  );
}
