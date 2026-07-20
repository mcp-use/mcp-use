/** Window field injected by `mcp-use dev` via the inspector CDN shell. */
interface DevCliWindow extends Window {
  __MCP_DEV_CLI__?: boolean;
}

/**
 * Whether dev-only inspector API routes (`dev/info`, tunnel start/stop) exist.
 *
 * `mcp-use dev` injects `window.__MCP_DEV_CLI__ = true` into the shell HTML.
 * Standalone inspector, pure-Vite dev, and `mcp-use start` omit the flag.
 */
export function hasDevCliApi(): boolean {
  if (typeof window === "undefined") return false;
  return (window as DevCliWindow).__MCP_DEV_CLI__ === true;
}
