const MCP_APPS_DEBUG_KEY = "mcp-use:debug-mcp-apps";

export function isMcpAppsDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(MCP_APPS_DEBUG_KEY) === "1" ||
    new URLSearchParams(window.location.search).get("debugMcpApps") === "1" ||
    window.location.hash === "#debugMcpApps"
  );
}

export function debugMcpApps(
  event: string,
  details: Record<string, unknown>
): void {
  if (!isMcpAppsDebugEnabled()) return;
  console.debug("[MCP Apps Debug]", event, JSON.stringify(details));
}
