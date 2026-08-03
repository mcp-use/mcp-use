/**
 * Procedural listing artwork.
 *
 * Real photos would mean a third-party image host and one more CSP domain, so
 * each card draws a deterministic SVG elevation from the home's `homeType` and
 * `accent`. Same listing, same picture, every render.
 */
import type { HomeType } from "./catalog.js";

/** Sky top, sky bottom, and facade color for each staged accent name. */
const ACCENTS: Record<string, readonly [string, string, string]> = {
  rose: ["#ffe3e6", "#f7b6bd", "#8f4c58"],
  ocean: ["#dceefb", "#a6cfe8", "#2f5d78"],
  gold: ["#fff2d6", "#f6d69a", "#8a6425"],
  sky: ["#e0f0ff", "#aed4f2", "#38607f"],
  mint: ["#ddf5ea", "#a9dfc8", "#2e6a55"],
  terracotta: ["#ffe8dc", "#f4bfa3", "#8d4e33"],
  plum: ["#efe3f7", "#c9aede", "#5a3a70"],
  sunset: ["#ffe9d4", "#fbbf8f", "#96502a"],
  sage: ["#e8f1e2", "#bcd4b0", "#4c6541"],
  midnight: ["#dde2f2", "#a9b4d6", "#333c62"],
  steel: ["#e7ebef", "#bcc6ce", "#4a555f"],
  lavender: ["#ece9fb", "#c2bbeb", "#4c4680"],
};

const FALLBACK = ACCENTS.steel as readonly [string, string, string];

/** Props for {@link ListingArt}. */
export interface ListingArtProps {
  /** Palette key from the staged listing. */
  accent: string;
  /** Property category; selects the silhouette. */
  homeType: HomeType;
  /** Stable id, used to namespace the gradient definitions. */
  id: string;
}

function Facade({
  homeType,
  color,
}: {
  homeType: HomeType;
  color: string;
}): React.JSX.Element {
  const glass = "rgba(255,255,255,0.72)";
  switch (homeType) {
    case "Condo":
      return (
        <g>
          <rect x="86" y="26" width="88" height="104" rx="4" fill={color} />
          <rect
            x="52"
            y="62"
            width="34"
            height="68"
            rx="3"
            fill={color}
            opacity="0.82"
          />
          {[0, 1, 2, 3, 4].map((row) =>
            [0, 1, 2].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={96 + col * 25}
                y={36 + row * 19}
                width="16"
                height="12"
                rx="1.5"
                fill={glass}
              />
            ))
          )}
        </g>
      );
    case "Loft":
      return (
        <g>
          <rect x="42" y="52" width="176" height="78" rx="3" fill={color} />
          <path d="M42 52 L86 30 L130 52 L174 30 L218 52 Z" fill={color} />
          {[0, 1, 2, 3].map((col) => (
            <rect
              key={col}
              x={54 + col * 42}
              y="66"
              width="30"
              height="46"
              rx="2"
              fill={glass}
            />
          ))}
        </g>
      );
    case "Townhouse":
      return (
        <g>
          {[0, 1, 2].map((unit) => (
            <g key={unit}>
              <rect
                x={54 + unit * 54}
                y={44 + unit * 4}
                width="48"
                height={86 - unit * 4}
                rx="3"
                fill={color}
                opacity={1 - unit * 0.08}
              />
              <rect
                x={64 + unit * 54}
                y={56 + unit * 4}
                width="28"
                height="20"
                rx="2"
                fill={glass}
              />
              <rect
                x={70 + unit * 54}
                y={94 + unit * 4}
                width="16"
                height="36"
                rx="2"
                fill={glass}
                opacity="0.5"
              />
            </g>
          ))}
        </g>
      );
    case "Multi-family":
      return (
        <g>
          <rect x="50" y="38" width="160" height="92" rx="3" fill={color} />
          <rect x="50" y="82" width="160" height="3" fill="rgba(0,0,0,0.18)" />
          {[0, 1].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={62 + col * 38}
                y={50 + row * 44}
                width="26"
                height="22"
                rx="2"
                fill={glass}
              />
            ))
          )}
        </g>
      );
    default:
      return (
        <g>
          <path d="M46 74 L130 30 L214 74 L214 130 L46 130 Z" fill={color} />
          <rect x="70" y="86" width="34" height="26" rx="2" fill={glass} />
          <rect x="156" y="86" width="34" height="26" rx="2" fill={glass} />
          <rect
            x="116"
            y="94"
            width="28"
            height="36"
            rx="2"
            fill={glass}
            opacity="0.55"
          />
          <rect x="176" y="40" width="14" height="26" rx="2" fill={color} />
        </g>
      );
  }
}

/** A deterministic SVG elevation standing in for a listing photo. */
export function ListingArt({
  accent,
  homeType,
  id,
}: ListingArtProps): React.JSX.Element {
  const [skyTop, skyBottom, facade] = ACCENTS[accent] ?? FALLBACK;
  const gradientId = `hs-sky-${id}`;
  return (
    <svg
      className="hs-art"
      viewBox="0 0 260 150"
      role="img"
      aria-label={`Illustration of a ${homeType.toLowerCase()}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skyTop} />
          <stop offset="100%" stopColor={skyBottom} />
        </linearGradient>
      </defs>
      <rect width="260" height="150" fill={`url(#${gradientId})`} />
      <circle cx="212" cy="34" r="16" fill="rgba(255,255,255,0.55)" />
      <path
        d="M0 118 C40 100 76 112 116 106 C158 100 196 114 260 104 L260 150 L0 150 Z"
        fill="rgba(255,255,255,0.42)"
      />
      <Facade homeType={homeType} color={facade} />
      <rect y="130" width="260" height="20" fill="rgba(0,0,0,0.1)" />
    </svg>
  );
}
