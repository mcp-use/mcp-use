/**
 * Runtime basePath resolution for the inspector client.
 *
 * `@mcp-use/inspector` ships as a prebuilt bundle. The consuming server's
 * `basePath` (from its `mcp-use.config.json`; default `/mcp`, `""` = root) is
 * only known at the consumer's runtime, so it CANNOT be baked into the Vite
 * build. The server injects it into the served HTML as `window.__MCP_BASE_PATH__`
 * (see `packages/inspector/src/server/shared-static.ts`); this module reads that
 * global so every client-side URL is derived from a single source.
 *
 * The inspector's own surface lives at `${basePath}/inspector` and its API under
 * `${basePath}/inspector/api/*`.
 */

/** Window fields injected by the inspector server at serve time. */
interface InspectorWindow extends Window {
  __MCP_BASE_PATH__?: string;
}

/**
 * Normalize a raw basePath into a canonical prefix: a single leading slash, no
 * trailing slash; `""`/`"/"` collapse to `""` (root-mounted). Mirrors mcp-use's
 * `normalizeBasePath` without taking a runtime dependency on the server package.
 */
function normalize(raw: string | undefined): string {
  if (raw === undefined || raw === null) return "/mcp";
  let value = raw
    .trim()
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  if (value === "" || value === "/") return "";
  if (!value.startsWith("/")) value = `/${value}`;
  return value;
}

/**
 * Resolve the server-wide basePath from `window.__MCP_BASE_PATH__`.
 *
 * Returns `/mcp` (the default) when the global is absent — e.g. pure-Vite dev
 * mode where the inspector backend's HTML injection never runs.
 */
export function getBasePath(): string {
  if (typeof window === "undefined") return "/mcp";
  return normalize((window as InspectorWindow).__MCP_BASE_PATH__);
}

/**
 * The inspector base path: `${basePath}/inspector` (default `/mcp/inspector`,
 * root-mount `/inspector`). All inspector routes live under this prefix.
 */
export function getInspectorBase(): string {
  return `${getBasePath()}/inspector`;
}

/**
 * Build an absolute (root-relative) inspector API URL under the current
 * basePath: `${basePath}/inspector/api/${path}`.
 *
 * @param path - API sub-path without a leading slash (e.g. `"chat/stream"`).
 */
export function inspectorApi(path: string): string {
  const trimmed = path.replace(/^\/+/, "");
  return `${getInspectorBase()}/api/${trimmed}`;
}
