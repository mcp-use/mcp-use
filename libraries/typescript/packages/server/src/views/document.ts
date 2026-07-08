import { basename } from "node:path";

import type { McpUseViewConfig } from "../react/public-assets.js";
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
 * Resolve the absolute URL prefix for the project's `public/` directory.
 *
 * @param origin - Request-resolved public origin.
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @returns Absolute prefix with trailing slash.
 */
export function resolvePublicBase(origin: string, basePath: string): string {
  return `${origin}${basePath}/_mcp-use/public/`;
}

/**
 * Escape view JS so it can sit inside a HTML `<script>` element without
 * premature termination or comment-open sequences.
 *
 * @param code - Raw module source.
 */
function escapeInlineScript(code: string): string {
  return code
    .replaceAll(/<\/script/gi, "<\\/script")
    .replaceAll("<!--", "\\x3C!--");
}

/**
 * Escape CSS so it can sit inside a HTML `<style>` element without premature
 * termination.
 *
 * @param css - Raw stylesheet text.
 */
function escapeInlineStyle(css: string): string {
  return css.replaceAll(/<\/style/gi, "<\\/style");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Synthesize a complete HTML document for a view from manifest data.
 *
 * Production (`kind: "inline"`) embeds JS and CSS directly so a srcdoc iframe
 * boots with zero network fetches for the view bundle. Dev
 * (`kind: "external"`) loads Vite module URLs for HMR.
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
  const viewConfig: McpUseViewConfig = {
    publicBase: resolvePublicBase(origin, basePath),
  };
  const configScript = `<script>globalThis.__mcpUseViewConfig=${JSON.stringify(viewConfig)};</script>`;

  if (entry.kind === "inline") {
    const styleTag =
      entry.css.length > 0
        ? `<style>${escapeInlineStyle(entry.css)}</style>`
        : "";
    const moduleScript = `<script type="module">${escapeInlineScript(entry.js)}</script>`;
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${configScript}
${styleTag}
</head>
<body>
<div id="root"></div>
${moduleScript}
</body>
</html>`;
  }

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
${configScript}
${cssLinks}
</head>
<body>
<div id="root"></div>
${scriptTags}
<script type="module" src="${escapeHtml(entryUrl)}"></script>
</body>
</html>`;
}
