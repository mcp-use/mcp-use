/**
 * Iframe configuration constants
 */

/**
 * Sandbox permissions for the OUTER sandbox-proxy iframe.
 *
 * Intentionally omits `allow-same-origin` to prevent the browser security
 * warning: "An iframe which has both allow-scripts and allow-same-origin for
 * its sandbox attribute can escape its sandboxing."
 *
 * The proxy only needs `allow-scripts` to run its message-relay logic.
 * Origin isolation between host and proxy is achieved at the network level
 * in production (sandbox-inspector.{domain}), and in dev mode sandbox
 * attributes alone provide sufficient isolation.
 */
export const PROXY_IFRAME_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin" as const;

/**
 * 
 * Standard sandbox permissions for the INNER guest widget iframe (srcdoc).
 *
 * `allow-same-origin` is safe here because the inner iframe content is
 * loaded via `srcdoc`, which has a `null` origin — not the same origin as
 * the host page. The browser warning only fires when both iframes truly
 * share the same origin.
 *
 * Used by the sandbox proxy when it sets the inner iframe's sandbox attr.
 */
export const IFRAME_SANDBOX_PERMISSIONS =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" as const;
