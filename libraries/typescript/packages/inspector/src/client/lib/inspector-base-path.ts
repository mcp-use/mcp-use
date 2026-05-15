/**
 * Runtime mount path for the inspector.
 *
 * The server injects `window.__MCP_INSPECTOR_BASE_PATH__` into the HTML shell
 * (see `injectRuntimeConfig` in `server/shared-static.ts`). When the inspector
 * is mounted at a non-default path (e.g. `/debug` via `routeConfig` in
 * mcp-use), all client-side fetches must be issued against that mount.
 *
 * Defaults to `/inspector` so standalone CLI / older hosts keep working.
 */
export function getInspectorBasePath(): string {
  if (typeof window === "undefined") return "/inspector";
  const fromWindow = (window as { __MCP_INSPECTOR_BASE_PATH__?: string })
    .__MCP_INSPECTOR_BASE_PATH__;
  if (typeof fromWindow === "string" && fromWindow.length > 0) {
    return fromWindow;
  }
  return "/inspector";
}

/**
 * Build a URL under the inspector mount.
 *
 * Example: `inspectorUrl("/api/chat/stream")` → `"/inspector/api/chat/stream"`
 * (or `"/debug/api/chat/stream"` when the inspector is mounted at `/debug`).
 */
export function inspectorUrl(suffix: string): string {
  const base = getInspectorBasePath();
  const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${base}${normalized}`;
}
