/**
 * `basePath` normalization and route builders.
 *
 * The whole framework HTTP surface (MCP transport, widget/public assets, OAuth
 * endpoints, inspector) relocates under a single, server-wide `basePath`
 * (default `/mcp`). Only `/.well-known/*` and `/favicon.ico` stay at root.
 *
 * `basePath` is resolved ONCE at boot (constructor field → `mcp-use.config.json`
 * `config.basePath` → default `/mcp`) and threaded through the mount layer.
 * This module is PURE (no I/O): it just normalizes the string and derives the
 * asset route prefixes so the `/mcp-use` literal lives in exactly one place.
 */

/**
 * The default `basePath` when neither the `MCPServer` constructor nor
 * `mcp-use.config.json` specifies one. Kept in sync with the config schema default.
 */
export const DEFAULT_BASE_PATH = "/mcp";

/**
 * Normalize a raw `basePath` into a canonical mount prefix:
 * - a single leading slash,
 * - no trailing slash,
 * - collapsed duplicate slashes,
 * - `""` or `"/"` → `""` (root-mounted; everything sits directly under root).
 *
 * The returned value is safe to template directly into route patterns and URLs
 * as `${basePath}/...` — when root-mounted it is the empty string, so
 * `${basePath}/sse` becomes `/sse`.
 *
 * @example
 * normalizeBasePath()           // "/mcp"  (undefined → default)
 * normalizeBasePath("/mcp")     // "/mcp"
 * normalizeBasePath("mcp/")     // "/mcp"
 * normalizeBasePath("/api//v1") // "/api/v1"
 * normalizeBasePath("/")        // ""      (root-mounted)
 * normalizeBasePath("")         // ""      (root-mounted)
 */
export function normalizeBasePath(
  raw: string | undefined = DEFAULT_BASE_PATH
): string {
  // Collapse duplicate slashes and strip surrounding whitespace.
  let value = raw.trim().replace(/\/{2,}/g, "/");

  // Strip every trailing slash.
  value = value.replace(/\/+$/, "");

  // Root or empty → root-mounted (empty prefix).
  if (value === "" || value === "/") {
    return "";
  }

  // Ensure exactly one leading slash.
  if (!value.startsWith("/")) {
    value = `/${value}`;
  }

  return value;
}

/**
 * Route/URL prefix for built widget assets: `${basePath}/mcp-use/widgets`.
 *
 * `basePath` must already be normalized (see {@link normalizeBasePath}).
 */
export function widgetAssetBase(basePath: string): string {
  return `${basePath}/mcp-use/widgets`;
}

/**
 * Route/URL prefix for public assets: `${basePath}/mcp-use/public`.
 *
 * `basePath` must already be normalized (see {@link normalizeBasePath}).
 */
export function publicAssetBase(basePath: string): string {
  return `${basePath}/mcp-use/public`;
}
