/**
 * Iframe configuration constants
 */

/**
 * Standard sandbox permissions for widget iframes
 * Used across all widget renderers for consistent security policy
 */
export const IFRAME_SANDBOX_PERMISSIONS =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" as const;
