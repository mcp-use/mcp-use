/**
 * DNS Rebinding Protection Example
 *
 * Run:
 *   pnpm dev
 *   # Optional: enable protection
 *   # ALLOWED_ORIGINS=http://localhost:3000 pnpm dev
 *
 * Quick checks (from this directory):
 *   # If ALLOWED_ORIGINS includes localhost: expected HTTP 403
 *   curl -i -H "Host: evil.example.com" -H "Origin: http://evil.example.com" \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"dns-example","version":"1.0.0"}}}' \
 *     http://localhost:3000/mcp
 *
 *   # Expected: HTTP 2xx
 *   curl -i -H "Host: localhost:3000" -H "Origin: http://localhost:3000" \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"dns-example","version":"1.0.0"}}}' \
 *     http://localhost:3000/mcp
 */

import { MCPServer, text } from "mcp-use/server";

const resolvedAllowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// Default behavior:
// - without allowedOrigins: no host validation (same as previous behavior)
// - with allowedOrigins: Host header must match configured hostnames (global)
const server = new MCPServer({
  name: "dns-rebinding-example",
  version: "1.0.0",
  description:
    "Example server showing localhost auto-protection and explicit allowedOrigins in production.",
  allowedOrigins:
    resolvedAllowedOrigins && resolvedAllowedOrigins.length > 0
      ? resolvedAllowedOrigins
      : undefined,
});

server.tool(
  {
    name: "dns_rebinding_status",
    description: "Show current DNS rebinding protection configuration.",
  },
  async () =>
    text(
      JSON.stringify(
        {
          nodeEnv: process.env.NODE_ENV ?? "development",
          hostValidation:
            resolvedAllowedOrigins && resolvedAllowedOrigins.length > 0
              ? "enabled"
              : "disabled",
          allowedOrigins:
            resolvedAllowedOrigins && resolvedAllowedOrigins.length > 0
              ? resolvedAllowedOrigins
              : "not configured",
        },
        null,
        2
      )
    )
);

await server.listen();
