/**
 * Runtime base-path helpers.
 *
 * When the inspector is embedded in an MCPServer that was configured with a
 * `basePath` (e.g. `"/api"`), the embedding host injects the prefix into a
 * `window.__MCP_BASE_PATH__` global from the served HTML. Same-origin
 * fetches and React Router need to read that global rather than assuming the
 * inspector lives at `/inspector` on the document origin.
 *
 * In standalone/CDN mode and when no basePath is configured, the global is
 * absent or empty, so these helpers return the historical bare values.
 */

declare global {
  interface Window {
    __MCP_BASE_PATH__?: string;
  }
}

/** Returns the runtime base-path prefix, normalized to no trailing slash. */
export function getBasePath(): string {
  if (typeof window === "undefined") return "";
  const raw = window.__MCP_BASE_PATH__;
  if (!raw || raw === "/") return "";
  return raw.replace(/\/+$/, "");
}

/**
 * Prefix an inspector-rooted path (one that historically started with
 * `/inspector/...`) with the runtime base path.
 *
 * @example inspectorPath("/inspector/api/chat/stream") → "/api/inspector/api/chat/stream"
 */
export function inspectorPath(path: string): string {
  return `${getBasePath()}${path}`;
}
