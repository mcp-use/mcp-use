/**
 * MCP Apps configuration constants
 */

import { inspectorApi } from "@/client/utils/basePath";

export const MCP_APPS_CONFIG = {
  /**
   * API endpoints for widget operations. Getters so the basePath-aware URL is
   * resolved lazily at call time (after `window.__MCP_BASE_PATH__` is injected).
   */
  API_ENDPOINTS: {
    get WIDGET_STORE() {
      return inspectorApi("mcp-apps/widget/store");
    },
    WIDGET_CONTENT: (toolCallId: string) =>
      inspectorApi(`mcp-apps/widget-content/${toolCallId}`),
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
