/**
 * Widget protocol detection utilities
 *
 * Determines which rendering protocol to use based on tool metadata and result.
 * Priority: MCP Apps → ChatGPT Apps SDK → MCP-UI → None
 */

export type WidgetProtocol =
  | "mcp-apps"
  | "chatgpt-app"
  | "mcp-ui"
  | "both" // Tool supports both MCP Apps and ChatGPT Apps SDK
  | null;

/**
 * Detect if a tool supports BOTH MCP Apps and ChatGPT Apps SDK
 *
 * @param toolMeta - Tool metadata from tool definition (_meta field)
 * @returns True if tool has both protocols
 */
export function hasBothProtocols(toolMeta?: Record<string, any>): boolean {
  const hasMcpApps =
    toolMeta?.ui?.resourceUri && typeof toolMeta.ui.resourceUri === "string";

  const hasChatGptApp =
    toolMeta?.["openai/outputTemplate"] &&
    typeof toolMeta["openai/outputTemplate"] === "string";

  return hasMcpApps && hasChatGptApp;
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
  // Priority 0: Check for both protocols first
  if (hasBothProtocols(toolMeta)) {
    return "both";
  }

  // Priority 1: MCP Apps (SEP-1865)
  // Check for ui.resourceUri in tool metadata
  if (
    toolMeta?.ui?.resourceUri &&
    typeof toolMeta.ui.resourceUri === "string"
  ) {
    return "mcp-apps";
  }

  // Priority 2: ChatGPT Apps SDK
  // Check for openai/outputTemplate in tool metadata
  if (
    toolMeta?.["openai/outputTemplate"] &&
    typeof toolMeta["openai/outputTemplate"] === "string"
  ) {
    return "chatgpt-app";
  }

  // Priority 3: MCP-UI (inline ui:// resource)
  // Check for ui:// resources in result content that are NOT MCP Apps or ChatGPT Apps
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

    // Exclude MCP Apps and ChatGPT Apps
    if (
      mimeType === "text/html+skybridge" ||
      mimeType === "text/html;profile=mcp-app"
    ) {
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

  if (protocol === "chatgpt-app") {
    return toolMeta?.["openai/outputTemplate"] || null;
  }

  if (protocol === "mcp-ui") {
    // Find the first ui:// resource in content
    const resource = toolResult?.content?.find(
      (item: any) =>
        item.type === "resource" &&
        item.resource?.uri?.startsWith("ui://") &&
        item.resource?.mimeType !== "text/html+skybridge" &&
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
  protocol: "mcp-apps" | "chatgpt-app",
  toolMeta?: Record<string, any>
): string | null {
  if (protocol === "mcp-apps") {
    return toolMeta?.ui?.resourceUri || null;
  }
  if (protocol === "chatgpt-app") {
    return toolMeta?.["openai/outputTemplate"] || null;
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
