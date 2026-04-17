/**
 * Dynamic origins example
 *
 * Demonstrates every `allowedOrigins` source working together:
 *
 *   - Static literals and wildcards
 *   - Async provider callback
 *   - Remote providerUrl (backed by an in-process mock provider with
 *     Cache-Control + ETag so conditional GETs (304 Not Modified) are visible
 *     in the logs)
 *   - HMAC-signed push webhook for instant updates
 *
 * Boot:
 *
 *   pnpm tsx examples/server/ui/mcp-apps/dynamic-origins/index.ts
 *
 * Then exercise the scenarios (see the companion README.md in this folder).
 */

import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { MCPServer } from "mcp-use/server";

const SERVER_PORT = Number(process.env.PORT ?? 3400);
const PROVIDER_PORT = Number(process.env.PROVIDER_PORT ?? 3401);
const WEBHOOK_SECRET =
  process.env.MCP_ALLOWED_ORIGINS_WEBHOOK_SECRET ?? "whsec_demo_secret";
const PROVIDER_URL = `http://localhost:${PROVIDER_PORT}/origins.json`;

/**
 * In-process mock provider. Serves a JSON list with standard HTTP validators.
 * Flip PROVIDER_LIST below at runtime (e.g. via kill/restart) to simulate
 * upstream changes. Revalidations will 304 until the ETag changes.
 */
const PROVIDER_LIST: string[] = [
  "https://canary.example.com",
  "https://*.staging.example.com",
];
const PROVIDER_ETAG = `"v${Date.now()}"`;

const providerHttp = createServer((req, res) => {
  if (!req.url?.startsWith("/origins.json")) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch && ifNoneMatch === PROVIDER_ETAG) {
    res.statusCode = 304;
    res.setHeader("ETag", PROVIDER_ETAG);
    res.setHeader(
      "Cache-Control",
      "public, max-age=10, stale-while-revalidate=60"
    );
    res.end();
    console.log(`[mock-provider] 304 Not Modified (ETag ${PROVIDER_ETAG})`);
    return;
  }
  const body = JSON.stringify(PROVIDER_LIST);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("ETag", PROVIDER_ETAG);
  res.setHeader(
    "Cache-Control",
    "public, max-age=10, stale-while-revalidate=60"
  );
  res.end(body);
  console.log(
    `[mock-provider] 200 OK (${PROVIDER_LIST.length} origins, ETag ${PROVIDER_ETAG})`
  );
});

providerHttp.listen(PROVIDER_PORT, () => {
  console.log(`[mock-provider] listening on ${PROVIDER_URL}`);
});

const server = new MCPServer({
  name: "dynamic-origins-example",
  version: "1.0.0",
  description:
    "Demonstrates dynamic allowedOrigins (static + wildcards + callback + providerUrl + webhook)",
  baseUrl: `http://localhost:${SERVER_PORT}`,
  allowedOrigins: {
    origins: [
      `http://localhost:${SERVER_PORT}`,
      "https://app.example.com",
      "https://*.preview.example.com",
    ],
    provider: async () => {
      // Any extra dynamic origins your app wants to inject at boot or on
      // revalidation. Useful for custom business logic (e.g. reading from a
      // database of tenants).
      return ["https://tenant-dynamic.example.com"];
    },
    providerUrl: PROVIDER_URL,
    fallbackRevalidateSeconds: 15,
    webhookSecret: WEBHOOK_SECRET,
  },
});

// Minimal programmatic widget — exercises CSP union but no HTML rewriting.
server.uiResource({
  type: "mcpApps",
  name: "origin-probe",
  title: "Origin Probe",
  description:
    "Minimal widget that renders the CSP/base-URL computed for each request. Compare resources/read with different Host headers to see the dynamic behaviour.",
  htmlTemplate: `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <h1>Origin Probe</h1>
    <p>This widget's CSP adapts to the allow-listed origin that matches the incoming request.</p>
  </body>
</html>`,
  metadata: {
    description: "Dynamic origin probe",
  },
  exposeAsTool: true,
});

await server.listen(SERVER_PORT);

console.log(`
Dynamic origins example is running.

Static sources configured:
  - http://localhost:${SERVER_PORT}
  - https://app.example.com
  - https://*.preview.example.com
Provider callback returns:
  - https://tenant-dynamic.example.com
providerUrl ${PROVIDER_URL} currently returns:
  ${PROVIDER_LIST.join("\n  ")}

Webhook:
  POST /mcp-use/internal/origins/refresh
  HMAC secret: ${WEBHOOK_SECRET}

Quick curl recipes:

  # 1) Resources/read as localhost (allowed)
  SESSION=$(curl -s -D - -X POST http://localhost:${SERVER_PORT}/mcp \\
    -H 'Accept: application/json, text/event-stream' \\
    -H 'Content-Type: application/json' \\
    -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"capabilities":{},"clientInfo":{"name":"curl","version":"0"},"protocolVersion":"2025-11-25"}}' | awk '/mcp-session-id:/ {print $2}' | tr -d '\\r')

  curl -s -X POST http://localhost:${SERVER_PORT}/mcp \\
    -H 'Accept: application/json, text/event-stream' \\
    -H 'Content-Type: application/json' \\
    -H "mcp-session-id: $SESSION" \\
    -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"ui://widget/origin-probe.html"}}'

  # 2) Rejected host -> 403 DNS rebinding
  curl -i -X POST http://localhost:${SERVER_PORT}/mcp \\
    -H 'Host: evil.example.com' \\
    -H 'Accept: application/json, text/event-stream' \\
    -H 'Content-Type: application/json' \\
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

  # 3) Webhook -> instant invalidation with inline origins
  TS=$(date +%s)
  BODY='{"origins":["https://hotpatched.example.com"]}'
  SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}" -hex | awk '{print $2}')
  curl -i -X POST http://localhost:${SERVER_PORT}/mcp-use/internal/origins/refresh \\
    -H "X-MCP-Signature: t=$TS,v1=$SIG" \\
    -H 'Content-Type: application/json' \\
    -d "$BODY"
`);
