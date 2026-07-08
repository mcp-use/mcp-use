/**
 * MCP Apps configuration constants
 */

export const MCP_APPS_CONFIG = {
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
