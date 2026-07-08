/**
 * MCP Apps (SEP-1865) Server Routes
 *
 * Serves the double-iframe sandbox proxy. Guest HTML is resolved client-side;
 * AppFrame posts `ui/notifications/sandbox-resource-ready` with `{ html, csp }`.
 * CSP mode / permissions / declared CSP arrive as URL query params on this page
 * (we omit SandboxConfig.csp so AppFrame does not add a competing `csp` param).
 */

import type { Hono } from "hono";
import { SANDBOX_PROXY_HTML } from "../../shared/sandbox-proxy-html.js";

/**
 * Register MCP Apps routes on the provided Hono app
 */
export function registerMcpAppsRoutes(app: Hono, basePath: string = "") {
  // All MCP Apps routes relocate under the server-wide basePath.
  const p = (suffix: string) => `${basePath}${suffix}`;

  // Serve sandbox proxy HTML
  app.get(p("/inspector/api/mcp-apps/sandbox-proxy"), (c) => {
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");

    // When FRAME_ANCESTORS is set: extend the built-in list (backward compatible). When unset: allow all (*).
    const additionalFrameAncestors = process.env.FRAME_ANCESTORS || "";
    const frameAncestors = additionalFrameAncestors
      ? [
          "'self'",
          "http://localhost:*",
          "http://127.0.0.1:*",
          "https://localhost:*",
          "https://127.0.0.1:*",
          additionalFrameAncestors,
        ]
          .filter(Boolean)
          .join(" ")
      : "*";

    c.header("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
    // Remove X-Frame-Options as it doesn't support multiple origins (CSP frame-ancestors takes precedence)
    c.res.headers.delete("X-Frame-Options");
    return c.body(SANDBOX_PROXY_HTML);
  });
}
