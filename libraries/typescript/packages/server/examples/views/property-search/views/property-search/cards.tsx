/**
 * Presentational pieces of the results rail and the map detail sheet.
 *
 * These components hold no state and call no tools — the view owns both — so
 * they stay readable next to `view.tsx`, which owns the tool surface.
 */
import { fullPrice, type Listing } from "./catalog.js";
import { ListingArt } from "./listing-art.js";

/** Extra staged facts loaded by the app-only `get-listing-details` tool. */
export interface ListingDetails {
  /** Listing the details belong to; guards against a stale response. */
  id: string;
  address: string;
  note: string;
  openHouse: string;
  hoa: string;
  pricePerSqft: number;
  estimatedPayment: number;
  walkScore: number;
  listedBy: string;
}

const statusClass = (status: Listing["status"]) =>
  status === "Open house"
    ? "is-open"
    : status === "New"
      ? "is-new"
      : status === "Pending"
        ? "is-pending"
        : "is-listed";

/** Props for {@link ListingCard}. */
export interface ListingCardProps {
  listing: Listing;
  /** Opened in the detail sheet. */
  selected: boolean;
  /** Pointer is over this card's map pin. */
  hovered: boolean;
  /** Hearted by the user or by `save-listings`. */
  saved: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  onToggleSave: () => void;
}

/** One home in the results rail. */
export function ListingCard({
  listing,
  selected,
  hovered,
  saved,
  onSelect,
  onHover,
  onToggleSave,
}: ListingCardProps): React.JSX.Element {
  return (
    <article
      className={`hs-card${selected ? " is-selected" : ""}${hovered ? " is-hovered" : ""}`}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="hs-card-media">
        <ListingArt
          accent={listing.accent}
          homeType={listing.homeType}
          id={listing.id}
        />
        <span className={`hs-badge ${statusClass(listing.status)}`}>
          {listing.status}
        </span>
        <button
          type="button"
          className={`hs-heart${saved ? " is-saved" : ""}`}
          aria-label={saved ? "Remove from saved homes" : "Save this home"}
          aria-pressed={saved}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSave();
          }}
        >
          {saved ? "♥" : "♡"}
        </button>
      </div>
      <div className="hs-card-body">
        <div className="hs-card-price">
          {fullPrice(listing.price)}
          <span className="hs-card-ppsf">
            ${Math.round(listing.price / listing.sqft)}/ft²
          </span>
        </div>
        <div className="hs-card-facts">
          <b>{listing.beds}</b> bd <i>·</i> <b>{listing.baths}</b> ba <i>·</i>{" "}
          <b>{listing.sqft.toLocaleString("en-US")}</b> ft²
        </div>
        <div className="hs-card-address">{listing.address}</div>
        <div className="hs-card-meta">
          {listing.area} · {listing.homeType} · built {listing.yearBuilt}
        </div>
      </div>
    </article>
  );
}

/** Props for {@link DetailSheet}. */
export interface DetailSheetProps {
  listing: Listing;
  /** Response from `get-listing-details`, or `undefined` while loading. */
  details: ListingDetails | undefined;
  saved: boolean;
  onClose: () => void;
  onToggleSave: () => void;
  /** Hand this home to the assistant as a follow-up message. */
  onAsk: () => void;
}

/** Floating card over the map for the selected home. */
export function DetailSheet({
  listing,
  details,
  saved,
  onClose,
  onToggleSave,
  onAsk,
}: DetailSheetProps): React.JSX.Element {
  const fresh = details?.id === listing.id ? details : undefined;
  return (
    <aside className="hs-sheet" aria-label={`Details for ${listing.address}`}>
      <button
        type="button"
        className="hs-sheet-close"
        aria-label="Close details"
        onClick={onClose}
      >
        ✕
      </button>
      <div className="hs-sheet-media">
        <ListingArt
          accent={listing.accent}
          homeType={listing.homeType}
          id={`sheet-${listing.id}`}
        />
      </div>
      <div className="hs-sheet-body">
        <div className="hs-sheet-head">
          <strong>{fullPrice(listing.price)}</strong>
          <span className={`hs-badge ${statusClass(listing.status)}`}>
            {listing.status}
          </span>
        </div>
        <div className="hs-card-facts">
          <b>{listing.beds}</b> bd <i>·</i> <b>{listing.baths}</b> ba <i>·</i>{" "}
          <b>{listing.sqft.toLocaleString("en-US")}</b> ft²
        </div>
        <div className="hs-sheet-address">{listing.address}</div>
        <p className="hs-sheet-note">{fresh?.note ?? listing.blurb}</p>
        <dl className="hs-sheet-stats">
          <div>
            <dt>Est. payment</dt>
            <dd>
              {fresh === undefined
                ? "—"
                : `$${fresh.estimatedPayment.toLocaleString("en-US")}/mo`}
            </dd>
          </div>
          <div>
            <dt>HOA</dt>
            <dd>{fresh?.hoa ?? (listing.hoa === 0 ? "None" : "…")}</dd>
          </div>
          <div>
            <dt>Walk score</dt>
            <dd>{fresh?.walkScore ?? "—"}</dd>
          </div>
          <div>
            <dt>Showing</dt>
            <dd>{fresh?.openHouse ?? "…"}</dd>
          </div>
        </dl>
        <div className="hs-sheet-actions">
          <button type="button" className="hs-btn is-primary" onClick={onAsk}>
            Ask the assistant
          </button>
          <button
            type="button"
            className={`hs-btn${saved ? " is-saved" : ""}`}
            onClick={onToggleSave}
          >
            {saved ? "♥ Saved" : "♡ Save"}
          </button>
        </div>
      </div>
    </aside>
  );
}
