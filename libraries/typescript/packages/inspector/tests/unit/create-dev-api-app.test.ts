import { describe, expect, it } from "vitest";
import { createDevApiApp } from "../../src/server/create-dev-api-app.js";

describe("Inspector dev API CORS", () => {
  it("allows relay capabilities and DPoP in the shared dev preflight", async () => {
    const app = createDevApiApp();
    const response = await app.fetch(
      new Request("http://localhost/inspector/api/proxy", {
        method: "OPTIONS",
        headers: {
          Origin: "https://inspector.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization, dpop, x-inspector-relay-token, x-target-url",
        },
      })
    );

    expect(response.status).toBe(204);
    const allowHeaders = response.headers.get("access-control-allow-headers");
    for (const header of [
      "Authorization",
      "Content-Type",
      "Accept",
      "X-Target-URL",
      "X-MCP-Target",
      "Mcp-Session-Id",
      "mcp-session-id",
      "mcp-protocol-version",
      "Mcp-Protocol-Version",
      "Mcp-Method",
      "Mcp-Name",
      "DPoP",
      "X-Inspector-Relay-Token",
      "Last-Event-ID",
      "X-Server-Id",
      "X-Requested-With",
    ]) {
      expect(allowHeaders).toContain(header);
    }
  });
});
