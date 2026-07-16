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
 * Read the injected public asset base URL, if present.
 *
 * @returns The request-resolved `publicBase`, or an empty string outside a
 *   synthesized view document.
 *
 * @internal
 */
export function getPublicBase(): string {
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
    const publicBase = getPublicBase();
    if (publicBase === "") {
      return path;
    }
    return `${publicBase}${path.slice(1)}`;
  }
  return path;
}
