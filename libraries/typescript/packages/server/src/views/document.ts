import type { McpUseViewConfig } from "../react/public-assets.js";
import { pathUnderBase } from "../fetch-app.js";
import type { ViewManifestEntry } from "./types.js";

/**
 * Resolve a registry asset path to an absolute URL for embedding in the
 * synthesized view document.
 *
 * Dev external registry paths are origin-absolute and `/`-prefixed.
 *
 * @param assetPath - Origin-absolute dev path starting with `/`.
 * @param origin - Request-resolved public origin.
 * @returns Absolute URL `${origin}${assetPath}`.
 * @throws When `assetPath` does not start with `/`.
 */
export function resolveAssetUrl(assetPath: string, origin: string): string {
  if (!assetPath.startsWith("/")) {
    throw new Error(
      `View manifest asset path must be origin-absolute (start with "/"); got ${JSON.stringify(assetPath)}`
    );
  }
  return `${origin}${assetPath}`;
}

/**
 * Build the HTTP path prefix for a view's built assets (no origin).
 *
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @param viewName - View directory / registry key.
 */
export function viewAssetsBasePath(basePath: string, viewName: string): string {
  return `${pathUnderBase(basePath, `_mcp-use/views/${viewName}`)}/`;
}

/**
 * Resolve a production or dev external asset path to an absolute URL.
 *
 * @param assetPath - Full CDN URL, origin-absolute dev path (`/…`), or
 *   view-relative production path (`assets/…`).
 * @param assetsBase - Assets URL prefix (origin + optional path).
 * @param basePath - MCP mount prefix.
 * @param viewName - View directory / registry key (required for view-relative paths).
 */
export function resolveExternalAssetUrl(
  assetPath: string,
  assetsBase: string,
  basePath: string,
  viewName: string
): string {
  if (
    assetPath.startsWith("http://") ||
    assetPath.startsWith("https://") ||
    assetPath.startsWith("data:")
  ) {
    return assetPath;
  }
  if (assetPath.startsWith("/")) {
    return resolveAssetUrl(assetPath, assetsBase);
  }
  return `${assetsBase}${viewAssetsBasePath(basePath, viewName)}${assetPath.replace(/^\/+/, "")}`;
}

/**
 * Resolve the absolute URL prefix for the project's `public/` directory.
 *
 * @param assetsBase - Assets URL prefix (origin + optional path).
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @returns Absolute prefix with trailing slash.
 */
export function resolvePublicBase(
  assetsBase: string,
  basePath: string
): string {
  return `${assetsBase}${pathUnderBase(basePath, "_mcp-use/public")}/`;
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
 * Synthesize a complete HTML document for a view from registry data.
 *
 * Production (`kind: "external"`) loads built assets over HTTP with absolute
 * URLs. Legacy `kind: "inline"` embeds JS/CSS directly. Dev uses Vite module
 * URLs (`kind: "external"` with origin-absolute paths).
 *
 * @param entry - Primed registry entry for the view.
 * @param assetsBase - Request-resolved assets URL prefix for absolute asset URLs.
 * @param basePath - MCP mount prefix (e.g. `/mcp`).
 * @param viewName - View directory / registry key (required for production external paths).
 */
export function synthesizeViewDocument(
  entry: ViewManifestEntry,
  assetsBase: string,
  basePath: string,
  viewName?: string
): string {
  const viewConfig: McpUseViewConfig = {
    publicBase: resolvePublicBase(assetsBase, basePath),
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

  if (viewName === undefined) {
    throw new Error(
      "viewName is required when synthesizing an external view document."
    );
  }

  const cssLinks = entry.css
    .map(
      (path) =>
        `<link rel="stylesheet" href="${escapeHtml(resolveExternalAssetUrl(path, assetsBase, basePath, viewName))}">`
    )
    .join("\n");

  const scriptTags = (entry.scripts ?? [])
    .map(
      (path) =>
        `<script type="module" src="${escapeHtml(resolveExternalAssetUrl(path, assetsBase, basePath, viewName))}"></script>`
    )
    .join("\n");

  const entryUrl = resolveExternalAssetUrl(
    entry.entry,
    assetsBase,
    basePath,
    viewName
  );

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
