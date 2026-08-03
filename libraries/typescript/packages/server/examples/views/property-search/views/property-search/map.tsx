/**
 * The Leaflet half of the view: an OpenStreetMap basemap with price-bubble pins.
 *
 * Leaflet is imperative, so the map is created once and reconciled by effects.
 * Camera moves are exposed through {@link MapHandle} rather than props because
 * the view tools ("fly to SoMa", "zoom in") are events, not state.
 */
import L from "leaflet";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { compactPrice, type AreaMeta, type Listing } from "./catalog.js";

import "leaflet/dist/leaflet.css";

/** Which way {@link MapHandle.pan} moves the camera. */
export type PanDirection = "north" | "south" | "east" | "west";

/** Imperative camera control, used by the view tools and the overlay buttons. */
export interface MapHandle {
  /** Animate to a neighborhood's framing camera. */
  flyToArea: (area: AreaMeta) => void;
  /** Animate to one home, zooming in at least to street level. */
  flyToListing: (listing: Listing) => void;
  /** Frame every passed home, or reset to the whole city when empty. */
  fitTo: (listings: readonly Listing[]) => void;
  /** Change zoom by whole steps; positive zooms in. */
  zoomBy: (steps: number) => void;
  /** Slide the camera one direction by a fraction of the viewport. */
  pan: (direction: PanDirection, fraction: number) => void;
  /** Current zoom level, rounded to Leaflet's 0.25 snap. */
  zoom: () => number;
}

/** Props for {@link PropertyMap}. */
export interface PropertyMapProps {
  /** Homes to pin, already filtered and sorted. */
  listings: readonly Listing[];
  /** Highlight ring target, or `null` when viewing the whole city. */
  activeArea: AreaMeta | null;
  /** Currently opened home. */
  selectedId: string | null;
  /** Home under the pointer in the results rail. */
  hoveredId: string | null;
  /** Homes the user hearted. */
  savedIds: readonly string[];
  /** Host color scheme; swaps the basemap between CARTO light and dark. */
  theme: "light" | "dark";
  /** Required OpenStreetMap / CARTO attribution HTML. */
  attribution: string;
  /** Called when a pin is clicked. */
  onSelect: (id: string) => void;
  /** Called on pin pointer enter (`id`) and leave (`null`). */
  onHover: (id: string | null) => void;
  /** Imperative camera handle. */
  ref?: Ref<MapHandle>;
}

const SF_CENTER: L.LatLngTuple = [37.7749, -122.4194];
const SF_ZOOM = 12.5;

const tileUrl = (theme: "light" | "dark") =>
  `https://basemaps.cartocdn.com/${theme === "dark" ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`;

function pinMarkup(
  listing: Listing,
  state: { selected: boolean; hovered: boolean; saved: boolean }
): string {
  const classes = ["hs-bubble"];
  if (state.selected) classes.push("is-selected");
  if (state.hovered) classes.push("is-hovered");
  if (listing.status === "Pending") classes.push("is-pending");
  return `<button type="button" class="${classes.join(" ")}" aria-label="${listing.address}, ${compactPrice(listing.price)}">
    <span class="hs-bubble-price">${compactPrice(listing.price)}</span>
    ${state.saved ? '<span class="hs-bubble-heart" aria-hidden="true">♥</span>' : ""}
  </button>`;
}

/** Interactive property map. See {@link MapHandle} for camera control. */
export function PropertyMap({
  listings,
  activeArea,
  selectedId,
  hoveredId,
  savedIds,
  theme,
  attribution,
  onSelect,
  onHover,
  ref,
}: PropertyMapProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const ringRef = useRef<L.Circle | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  // Handlers live in refs so marker click bindings survive parent re-renders
  // without tearing down and rebuilding every pin.
  const selectRef = useRef(onSelect);
  const hoverRef = useRef(onHover);
  selectRef.current = onSelect;
  hoverRef.current = onHover;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const map = L.map(container, {
      center: SF_CENTER,
      zoom: SF_ZOOM,
      zoomControl: false,
      attributionControl: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
    });
    mapRef.current = map;
    map.attributionControl.setPrefix(false);

    const resize = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resize.observe(container);

    return () => {
      resize.disconnect();
      markersRef.current.clear();
      ringRef.current = null;
      tileRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Basemap follows the host theme; the tile layer is replaced rather than
  // mutated so Leaflet re-requests with a clean cache.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(tileUrl(theme), {
      attribution,
      detectRetina: true,
      maxZoom: 19,
      minZoom: 10,
    }).addTo(map);
  }, [theme, attribution]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    ringRef.current?.remove();
    ringRef.current = null;
    if (activeArea === null) return;
    ringRef.current = L.circle([activeArea.lat, activeArea.lng], {
      radius: activeArea.radius,
      className: "hs-ring",
      interactive: false,
    }).addTo(map);
  }, [activeArea]);

  // Reconcile pins by id: add new homes, drop filtered-out ones, and leave
  // untouched pins in place so the map never flickers on a re-filter.
  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    const markers = markersRef.current;
    const wanted = new Set(listings.map((listing) => listing.id));

    for (const [id, marker] of markers) {
      if (!wanted.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    for (const listing of listings) {
      if (markers.has(listing.id)) continue;
      const marker = L.marker([listing.lat, listing.lng], {
        // Zero-size icon: the bubble positions itself in CSS relative to the
        // exact coordinate, so pins keep their shape at any zoom.
        icon: L.divIcon({
          className: "hs-pin",
          html: pinMarkup(listing, {
            selected: false,
            hovered: false,
            saved: false,
          }),
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        riseOnHover: true,
        keyboard: false,
      }).addTo(map);
      marker.on("click", () => selectRef.current(listing.id));
      marker.on("mouseover", () => hoverRef.current(listing.id));
      marker.on("mouseout", () => hoverRef.current(null));
      markers.set(listing.id, marker);
    }
  }, [listings]);

  // Selection, hover, and saved state are class toggles on the live pin
  // elements — cheaper and flicker-free compared to re-creating icons.
  useEffect(() => {
    const saved = new Set(savedIds);
    for (const listing of listings) {
      const element = markersRef.current
        .get(listing.id)
        ?.getElement()
        ?.querySelector(".hs-bubble");
      if (!(element instanceof HTMLElement)) continue;
      element.classList.toggle("is-selected", selectedId === listing.id);
      element.classList.toggle("is-hovered", hoveredId === listing.id);
      const heart = element.querySelector(".hs-bubble-heart");
      const isSaved = saved.has(listing.id);
      if (isSaved && heart === null) {
        const span = document.createElement("span");
        span.className = "hs-bubble-heart";
        span.setAttribute("aria-hidden", "true");
        span.textContent = "♥";
        element.append(span);
      } else if (!isSaved && heart !== null) {
        heart.remove();
      }
      if (selectedId === listing.id) {
        markersRef.current.get(listing.id)?.setZIndexOffset(1000);
      } else {
        markersRef.current.get(listing.id)?.setZIndexOffset(0);
      }
    }
  }, [listings, selectedId, hoveredId, savedIds]);

  useImperativeHandle(
    ref,
    () => ({
      flyToArea: (area) => {
        mapRef.current?.flyTo([area.lat, area.lng], area.zoom, {
          duration: 1.1,
        });
      },
      flyToListing: (listing) => {
        const map = mapRef.current;
        if (map === null) return;
        map.flyTo([listing.lat, listing.lng], Math.max(map.getZoom(), 16), {
          duration: 0.9,
        });
      },
      fitTo: (items) => {
        const map = mapRef.current;
        if (map === null) return;
        if (items.length === 0) {
          map.flyTo(SF_CENTER, SF_ZOOM, { duration: 0.8 });
          return;
        }
        if (items.length === 1) {
          const only = items[0];
          if (only !== undefined) {
            map.flyTo([only.lat, only.lng], 16, { duration: 0.8 });
          }
          return;
        }
        map.flyToBounds(
          L.latLngBounds(items.map((item) => [item.lat, item.lng])),
          {
            paddingTopLeft: [60, 90],
            paddingBottomRight: [60, 140],
            maxZoom: 16,
          }
        );
      },
      zoomBy: (steps) => {
        const map = mapRef.current;
        if (map === null) return;
        map.setZoom(map.getZoom() + steps, { animate: true });
      },
      pan: (direction, fraction) => {
        const map = mapRef.current;
        if (map === null) return;
        const size = map.getSize();
        const dx =
          direction === "east"
            ? size.x * fraction
            : direction === "west"
              ? -size.x * fraction
              : 0;
        const dy =
          direction === "south"
            ? size.y * fraction
            : direction === "north"
              ? -size.y * fraction
              : 0;
        map.panBy([dx, dy], { animate: true });
      },
      zoom: () => mapRef.current?.getZoom() ?? SF_ZOOM,
    }),
    []
  );

  return <div className="hs-map-canvas" ref={containerRef} />;
}
