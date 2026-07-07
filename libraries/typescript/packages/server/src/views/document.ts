import { basename } from "node:path";

import type { ViewManifestEntry } from "./types.js";

/**
 * Resolve a manifest asset path to an absolute URL for embedding in the
 * synthesized view document.
 *
 * @param assetPath - Manifest path (relative to `.mcp-use/build/`) or an
 *   origin-absolute dev path starting with `/`.
 * @param origin - Request-resolved public origin.
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 */
export function resolveAssetUrl(
  assetPath: string,
  origin: string,
  basePath: string
): string {
  if (assetPath.startsWith("/")) {
    return `${origin}${assetPath}`;
  }
  const file = basename(assetPath);
  return `${origin}${basePath}/_mcp-use/assets/${file}`;
}

/**
 * Synthesize a complete HTML document for a view from manifest data.
 *
 * @param entry - Primed manifest entry for the view.
 * @param origin - Request-resolved public origin for absolute asset URLs.
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 */
export function synthesizeViewDocument(
  entry: ViewManifestEntry,
  origin: string,
  basePath: string
): string {
  const cssLinks = entry.css
    .map(
      (path) =>
        `<link rel="stylesheet" href="${escapeHtml(resolveAssetUrl(path, origin, basePath))}">`
    )
    .join("\n");

  const scriptTags = (entry.scripts ?? [])
    .map(
      (path) =>
        `<script type="module" src="${escapeHtml(resolveAssetUrl(path, origin, basePath))}"></script>`
    )
    .join("\n");

  const entryUrl = resolveAssetUrl(entry.entry, origin, basePath);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${cssLinks}
</head>
<body>
<div id="root"></div>
${scriptTags}
<script type="module" src="${escapeHtml(entryUrl)}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
