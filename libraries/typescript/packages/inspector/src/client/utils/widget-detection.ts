/**
 * Widget protocol detection utilities
 *
 * Determines which rendering protocol to use based on tool metadata and result.
 * Priority: MCP Apps → ChatGPT Apps SDK → MCP-UI → None
 */

export type WidgetProtocol =
  | "mcp-apps"
  | "mcp-ui"
  | "both"
  | null;

/**
 * Detect if a tool supports BOTH MCP Apps protocols (kept for API compatibility)
 *
 * @param toolMeta - Tool metadata from tool definition (_meta field)
 * @returns True if tool has both protocols
 */
export function hasBothProtocols(toolMeta?: Record<string, any>): boolean {
  const hasMcpApps =
    toolMeta?.ui?.resourceUri && typeof toolMeta.ui.resourceUri === "string";

  return !!hasMcpApps;
}

/**
 * Detect which widget protocol to use for rendering
 *
 * @param toolMeta - Tool metadata from tool definition (_meta field)
 * @param toolResult - Tool execution result
 * @returns The detected protocol or null if no custom UI
 */
export function detectWidgetProtocol(
  toolMeta?: Record<string, any>,
  toolResult?: any
): WidgetProtocol {
  // Priority 1: MCP Apps (SEP-1865)
  if (
    toolMeta?.ui?.resourceUri &&
    typeof toolMeta.ui.resourceUri === "string"
  ) {
    return "mcp-apps";
  }

  // Priority 2: MCP-UI (inline ui:// resource)
  if (hasInlineUIResource(toolResult)) {
    return "mcp-ui";
  }

  return null;
}

/**
 * Check if tool result contains an inline MCP-UI resource
 *
 * MCP-UI resources are ui:// URIs that are NOT:
 * - text/html+skybridge (ChatGPT Apps SDK)
 * - text/html;profile=mcp-app (MCP Apps)
 */
function hasInlineUIResource(toolResult?: any): boolean {
  if (!toolResult?.content || !Array.isArray(toolResult.content)) {
    return false;
  }

  return toolResult.content.some((item: any) => {
    if (item.type !== "resource" || !item.resource?.uri) {
      return false;
    }

    const uri = item.resource.uri;
    const mimeType = item.resource.mimeType;

    // Must be a ui:// URI
    if (!uri.startsWith("ui://")) {
      return false;
    }

    // Exclude MCP Apps
    if (mimeType === "text/html;profile=mcp-app") {
      return false;
    }

    return true;
  });
}

/**
 * Extract resource URI for a detected widget protocol
 */
export function extractWidgetResourceUri(
  protocol: WidgetProtocol,
  toolMeta?: Record<string, any>,
  toolResult?: any
): string | null {
  if (!protocol) return null;

  if (protocol === "mcp-apps") {
    return toolMeta?.ui?.resourceUri || null;
  }

  if (protocol === "mcp-ui") {
    // Find the first ui:// resource in content
    const resource = toolResult?.content?.find(
      (item: any) =>
        item.type === "resource" &&
        item.resource?.uri?.startsWith("ui://") &&
        item.resource?.mimeType !== "text/html;profile=mcp-app"
    );
    return resource?.resource?.uri || null;
  }

  return null;
}

/**
 * Extract resource URI for a specific protocol (used when toggling between protocols)
 *
 * @param protocol - The specific protocol to get URI for
 * @param toolMeta - Tool metadata from tool definition (_meta field)
 * @returns The resource URI or null
 */
export function getResourceUriForProtocol(
  protocol: "mcp-apps",
  toolMeta?: Record<string, any>
): string | null {
  if (protocol === "mcp-apps") {
    return toolMeta?.ui?.resourceUri || null;
  }
  return null;
}

/**
 * Check if a tool has widget support that can be pre-rendered
 * (detected from metadata before tool execution)
 *
 * Returns true for MCP Apps and ChatGPT Apps (detected from metadata)
 * Returns false for MCP-UI (requires result to detect)
 *
 * @param toolMeta - Tool metadata from tool definition (_meta field)
 * @returns True if the widget can be pre-rendered before tool execution completes
 */
export function canPreRenderWidget(toolMeta?: Record<string, any>): boolean {
  if (!toolMeta) return false;

  const protocol = detectWidgetProtocol(toolMeta, undefined);
  // mcp-ui requires result to detect, so it cannot be pre-rendered
  return protocol !== null && protocol !== "mcp-ui";
}
