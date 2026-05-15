/**
 * MCP Apps configuration constants
 */

import { inspectorUrl } from "@/client/lib/inspector-base-path";

export const MCP_APPS_CONFIG = {
  /**
   * API endpoints for widget operations. Computed lazily so the runtime
   * `window.__MCP_INSPECTOR_BASE_PATH__` injected by the host is available.
   */
  API_ENDPOINTS: {
    get WIDGET_STORE(): string {
      return inspectorUrl("/api/mcp-apps/widget/store");
    },
    WIDGET_CONTENT: (toolCallId: string) =>
      inspectorUrl(`/api/mcp-apps/widget-content/${toolCallId}`),
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
