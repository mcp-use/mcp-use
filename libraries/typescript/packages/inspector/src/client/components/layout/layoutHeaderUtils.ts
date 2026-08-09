import type { McpServer } from "@mcp-use/client/react";
import type { TabType } from "@/client/context/InspectorContext";
import { isInspectorSamplingAvailable } from "@/client/utils/samplingProtocol";
export { isMcpUseTunnelUrl } from "@/client/utils/servers";

export function tunnelOriginFromMcpUrl(mcpUrl: string | null): string | null {
  if (!mcpUrl) return null;
  try {
    const u = new URL(mcpUrl);
    if (u.protocol === "https:") {
      return u.origin;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function getTabCount(tabId: string, server: McpServer): number {
  if (tabId === "tools") {
    return server.tools.length;
  } else if (tabId === "prompts") {
    return server.prompts.length;
  } else if (tabId === "resources") {
    return server.resources.length;
  } else if (tabId === "skills") {
    return server.skills?.length ?? 0;
  } else if (tabId === "sampling") {
    return server.pendingSamplingRequests?.length || 0;
  } else if (tabId === "elicitation") {
    return server.pendingElicitationRequests?.length || 0;
  } else if (tabId === "notifications") {
    return server.unreadNotificationCount;
  }
  return 0;
}

export function supportsSkills(server: McpServer): boolean {
  return server.extensions?.["io.modelcontextprotocol/skills"] !== undefined;
}

export const SKILLS_UNSUPPORTED_MESSAGE =
  "This server does not advertise the Skills over MCP extension.";
export const SKILLS_EMPTY_CATALOG_MESSAGE =
  "This server advertises Skills over MCP, but returned an empty catalog.";

export type SkillsState = "unsupported" | "empty" | "available";

/** An advertised empty catalog is unavailable until the server supplies skills. */
export function getSkillsState(server: McpServer): SkillsState {
  if (!supportsSkills(server)) return "unsupported";
  return (server.skills?.length ?? 0) === 0 ? "empty" : "available";
}

/** Include the advertised-empty status in an otherwise icon-only tab label. */
export function getSkillsAccessibleLabel(
  label: string,
  state: SkillsState
): string {
  return state === "empty" ? `${label}: advertised but empty` : label;
}

/** Whether a tab can be selected for the current server. */
export function isTabUsable(tabId: TabType, server: McpServer): boolean {
  if (tabId === "skills") return getSkillsState(server) === "available";
  if (tabId === "sampling") return isInspectorSamplingAvailable(server);
  return true;
}

/**
 * Pick a usable destination when Skills is unavailable.
 *
 * Without an embedded visibility allowlist, Tools remains the default. When an
 * allowlist is present, preserve its order and never redirect to a hidden tab.
 */
export function getSkillsFallbackTab(
  server: McpServer,
  visibleTabs?: TabType[]
): TabType | null {
  if (server.state !== "ready" || getSkillsState(server) === "available") {
    return null;
  }
  const candidates = visibleTabs ?? (["tools"] satisfies TabType[]);
  return candidates.find((tabId) => isTabUsable(tabId, server)) ?? null;
}

export function shouldShowDot(
  tabId: string,
  count: number,
  collapsed: boolean
): boolean {
  const dotTabs = ["sampling", "elicitation", "notifications"];
  return collapsed && count > 0 && dotTabs.includes(tabId);
}
