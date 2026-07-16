import type { McpServer } from "@mcp-use/client/react";

export function getTabCount(tabId: string, server: McpServer): number {
  if (tabId === "tools") {
    return server.tools.length;
  } else if (tabId === "prompts") {
    return server.prompts.length;
  } else if (tabId === "resources") {
    return server.resources.length;
  } else if (tabId === "sampling") {
    return server.pendingSamplingRequests?.length || 0;
  } else if (tabId === "elicitation") {
    return server.pendingElicitationRequests?.length || 0;
  } else if (tabId === "notifications") {
    return server.unreadNotificationCount;
  }
  return 0;
}

export function shouldShowDot(
  tabId: string,
  count: number,
  collapsed: boolean
): boolean {
  const dotTabs = ["sampling", "elicitation", "notifications"];
  return collapsed && count > 0 && dotTabs.includes(tabId);
}
