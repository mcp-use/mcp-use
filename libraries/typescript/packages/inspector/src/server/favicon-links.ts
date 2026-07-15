/** Static favicon assets copied to CDN / public alongside the inspector bundle. */
export const INSPECTOR_FAVICON_ASSETS = [
  "favicon.svg",
  "favicon-96x96.png",
  "favicon.ico",
  "apple-touch-icon.png",
  "site.webmanifest",
  "web-app-manifest-192x192.png",
  "web-app-manifest-512x512.png",
  // Legacy dual-SVG pair — keep for backward-compatible CDN consumers.
  "favicon-black.svg",
  "favicon-white.svg",
] as const;

/**
 * Render `<link>` tags for inspector favicons, matching the website's
 * RealFaviconGenerator setup in `website.mcp-use/src/app/layout.tsx`.
 */
export function renderInspectorFaviconLinks(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return [
    `<link rel="icon" type="image/svg+xml" href="${base}/favicon.svg" />`,
    `<link rel="icon" type="image/png" sizes="96x96" href="${base}/favicon-96x96.png" />`,
    `<link rel="icon" href="${base}/favicon.ico" sizes="any" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${base}/apple-touch-icon.png" />`,
    `<link rel="manifest" href="${base}/site.webmanifest" />`,
  ].join("\n    ");
}
