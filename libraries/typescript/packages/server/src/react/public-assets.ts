/**
 * Client-side resolution for root-relative public asset paths.
 *
 * The synthesized view document injects {@link McpUseViewConfig} before any
 * module scripts so iframe code can resolve `/…` paths to absolute URLs.
 */

/**
 * Request-scoped view configuration injected into the synthesized document.
 *
 * @remarks
 * Set per request by {@link synthesizeViewDocument} — not at build or boot
 * time — so public asset URLs stay correct behind proxies and tunnels.
 */
export interface McpUseViewConfig {
  /**
   * Absolute URL prefix for the project's `public/` directory, including a
   * trailing slash (e.g. `http://127.0.0.1:3000/mcp/_mcp-use/public/`).
   */
  publicBase: string;
}

declare global {
  var __mcpUseViewConfig: McpUseViewConfig | undefined;
}

/**
 * Return the request-resolved base URL for files in the project's `public/`
 * directory.
 *
 * @remarks
 * The returned URL always includes a trailing slash. Append public-folder
 * paths without a leading slash. The URL is resolved for the current request,
 * so it remains correct behind proxies, tunnels, and `MCP_ASSETS_URL`.
 *
 * Outside a synthesized browser view document, the function returns an empty
 * string.
 *
 * @example
 * ```ts
 * import { getPublicBaseUrl } from "mcp-use/react";
 *
 * const publicBaseUrl = getPublicBaseUrl();
 * const stylesheetUrl = `${publicBaseUrl}assets/vendor.css`;
 * const wasmUrl = `${publicBaseUrl}doom/websockets-doom.wasm`;
 * ```
 *
 * @returns The absolute public-folder base URL with a trailing slash, or an
 *   empty string when no injected view configuration is available.
 */
export function getPublicBaseUrl(): string {
  if (typeof globalThis === "undefined") {
    return "";
  }
  return globalThis.__mcpUseViewConfig?.publicBase ?? "";
}

/**
 * Resolve a root-relative path from the project's `public/` folder to an
 * absolute URL for the current view iframe.
 *
 * Root-relative paths (starting with `/`) are resolved against the injected
 * {@link McpUseViewConfig.publicBase}. Absolute `http(s):` and `data:` URLs
 * pass through unchanged. Fully-relative paths (no leading slash) are returned
 * as-is. Not part of the public API — public assets are consumed through the
 * {@link Image} component.
 *
 * @param path - Author path, typically root-relative from the `public/` folder
 *   (e.g. `/fruits/apple.png`).
 * @returns The resolved absolute URL, or the original path when no base is set.
 *
 * @internal
 */
export function publicAsset(path: string): string {
  if (path === "") {
    return path;
  }
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:")
  ) {
    return path;
  }
  if (path.startsWith("/")) {
    const publicBase = getPublicBaseUrl();
    if (publicBase === "") {
      return path;
    }
    return `${publicBase}${path.slice(1)}`;
  }
  return path;
}
