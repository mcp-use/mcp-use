/**
 * MCP Apps configuration constants
 */

import { inspectorPath } from "../utils/basePath";

export const MCP_APPS_CONFIG = {
  /**
   * API endpoints for widget operations
   *
   * Note: these are getters (not eager string literals) so they pick up the
   * runtime basePath even if this module is imported before
   * `window.__MCP_BASE_PATH__` has been read off the injected script.
   */
  API_ENDPOINTS: {
    WIDGET_STORE: () => inspectorPath("/inspector/api/mcp-apps/widget/store"),
    WIDGET_CONTENT: (toolCallId: string) =>
      inspectorPath(`/inspector/api/mcp-apps/widget-content/${toolCallId}`),
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
    /** Picture-in-picture max width (cap so widget can expand up to this) */
    PIP_MAX_WIDTH: 700,
    /** Picture-in-picture height */
    PIP_HEIGHT: 400,
    /** Default iframe height for inline mode */
    DEFAULT_HEIGHT: 400,
  },
} as const;
