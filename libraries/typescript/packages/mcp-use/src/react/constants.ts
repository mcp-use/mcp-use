/**
 * Widget and MCP Apps Bridge constants
 */

/**
 * Default values for widget configuration
 */
export const WIDGET_DEFAULTS = {
  /** Polling interval for checking window.openai availability (ms) */
  POLL_INTERVAL: 100,
  /** Maximum timeout for window.openai availability check (ms) */
  MAX_TIMEOUT: 5000,
  /** Default maximum height for widgets */
  MAX_HEIGHT: 600,
  /** Default locale */
  LOCALE: "en",
} as const;

/**
 * MCP Apps Bridge configuration
 */
export const MCP_APPS_BRIDGE_CONFIG = {
  /** Request timeout (ms) */
  REQUEST_TIMEOUT: 30000,
  /** App name for identification */
  APP_NAME: "mcp-use-widget",
  /** App version */
  APP_VERSION: "1.0.0",
  /** MCP Apps protocol version */
  PROTOCOL_VERSION: "2025-06-18",
} as const;
