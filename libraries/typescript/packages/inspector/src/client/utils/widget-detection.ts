/**
 * Widget protocol detection utilities
 *
 * Determines whether a tool result should render as an MCP App (SEP-1865).
 */

export type WidgetProtocol = "mcp-apps" | null;

/**
 * Detect which widget protocol to use for rendering
 *
 * @param toolMeta - Tool metadata from tool definition (_meta field)
 * @param _toolResult - Tool execution result (unused; kept for call-site compatibility)
 * @returns "mcp-apps" when `_meta.ui.resourceUri` is present, otherwise null
 */
export function detectWidgetProtocol(
  toolMeta?: Record<string, any>,
  _toolResult?: any
): WidgetProtocol {
  if (
    toolMeta?.ui?.resourceUri &&
    typeof toolMeta.ui.resourceUri === "string"
  ) {
    return "mcp-apps";
  }

  return null;
}

/**
 * Extract the MCP Apps resource URI from tool metadata
 *
 * @param protocol - Must be "mcp-apps"
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
