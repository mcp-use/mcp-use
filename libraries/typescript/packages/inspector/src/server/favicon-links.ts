/** Bust Chrome's aggressive favicon cache when the asset changes. */
export const FAVICON_CACHE_VERSION = "4";

/** Static favicon assets copied to CDN / public alongside the inspector bundle. */
export const INSPECTOR_FAVICON_ASSETS = [
  "favicon.svg",
  "favicon-96x96.png",
  "favicon.ico",
  "apple-touch-icon.png",
  "site.webmanifest",
  "web-app-manifest-192x192.png",
  "web-app-manifest-512x512.png",
  "favicon-black.svg",
  "favicon-white.svg",
] as const;

/**
 * Render `<link>` tags for inspector favicons.
 *
 * Uses same-origin `favicon-black.svg` (light icon in all color schemes).
 * Do not point at inspector-cdn — production CDN still ships a dark-mode SVG.
 */
export function renderInspectorFaviconLinks(basePath = ""): string {
  const prefix = basePath.replace(/\/$/, "");
  const href = `${prefix}/favicon-black.svg?v=${FAVICON_CACHE_VERSION}`;
  return `<link rel="icon" type="image/svg+xml" href="${href}" />`;
}
