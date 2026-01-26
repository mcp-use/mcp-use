/**
 * MCP Apps configuration constants
 */

export const MCP_APPS_CONFIG = {
  /**
   * API endpoints for widget operations
   */
  API_ENDPOINTS: {
    WIDGET_STORE: "/inspector/api/mcp-apps/widget/store",
    DEV_WIDGET_CONTENT: (toolCallId: string) =>
      `/inspector/api/mcp-apps/dev-widget-content/${toolCallId}`,
    WIDGET_CONTENT: (toolCallId: string) =>
      `/inspector/api/mcp-apps/widget-content/${toolCallId}`,
  },

  /**
   * Protocol version for MCP Apps bridge
   */
  VERSION: "0.16.2",

  /**
   * Timeout values (in milliseconds)
   */
  TIMEOUTS: {
    /** Tool call timeout - 10 minutes */
    TOOL_CALL: 600000,
    /** Animation duration for size changes */
    ANIMATION: 300,
  },

  /**
   * Default dimensions for widget display
   */
  DIMENSIONS: {
    /** Picture-in-picture width */
    PIP_WIDTH: 768,
    /** Picture-in-picture height */
    PIP_HEIGHT: 384,
    /** Default iframe height for inline mode */
    DEFAULT_HEIGHT: 400,
  },
} as const;
