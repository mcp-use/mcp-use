import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MCPServer } from "../../src/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

describe("Dynamic origins integration", () => {
  let server: any;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const PORT = 3197;
  const BASE = `http://localhost:${PORT}`;
  const MCP_URL = `${BASE}/mcp`;
  const WEBHOOK_SECRET = "whsec_test_integration";

  beforeAll(async () => {
    server = new MCPServer({
      name: "dynamic-origins-test",
      version: "1.0.0",
      baseUrl: BASE,
      allowedOrigins: {
        origins: [
          `http://localhost:${PORT}`,
          "https://app.example.com",
          "https://*.preview.example.com",
        ],
        webhookSecret: WEBHOOK_SECRET,
      },
    });

    // Programmatic widget — no raw HTML, so CSP union is what we assert.
    server.uiResource({
      type: "mcpApps",
      name: "origin-probe",
      title: "Origin Probe",
      description: "Minimal widget for testing dynamic origin/CSP",
      htmlTemplate: "<html><body>probe</body></html>",
      metadata: {
        description: "Minimal widget",
      },
    });

    await server.listen(PORT);

    client = new Client(
      { name: "origins-test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      // localhost is allow-listed, so this connects fine.
    });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    await transport?.close();
    await server?.close?.();
  }, 10_000);

  it("allow-listed Host results in that origin being in widget CSP", async () => {
    const result = await client.readResource({
      uri: "ui://widget/origin-probe.html",
    });
    const contents = (result as any).contents ?? [];
    expect(contents.length).toBeGreaterThan(0);
    const csp =
      (contents[0]?._meta?.ui?.csp as Record<string, string[]> | undefined) ||
      undefined;
    expect(csp).toBeDefined();
    const flattened = [
      ...(csp!.resourceDomains ?? []),
      ...(csp!.connectDomains ?? []),
      ...(csp!.baseUriDomains ?? []),
    ];
    // Localhost-on-the-configured-port is allow-listed, so it shows up.
    expect(flattened).toContain(`http://localhost:${PORT}`);
    // The full allow-list is unioned into CSP.
    expect(flattened).toContain("https://app.example.com");
    expect(flattened).toContain("https://*.preview.example.com");
  });

  it("rejects /mcp with a non-allow-listed Host (403)", async () => {
    const res = await server.app.request("http://localhost/mcp", {
      method: "POST",
      headers: {
        Host: "evil.example.com",
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(res.status).toBe(403);
  });

  it("webhook accepts valid HMAC and 401s on bad signature or stale timestamp", async () => {
    const body = JSON.stringify({
      origins: ["https://added.example.com"],
    });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${t}.${body}`)
      .digest("hex");

    const ok = await server.app.request(
      "http://localhost/mcp-use/internal/origins/refresh",
      {
        method: "POST",
        headers: {
          Host: `localhost:${PORT}`,
          "Content-Type": "application/json",
          "X-MCP-Signature": `t=${t},v1=${v1}`,
        },
        body,
      }
    );
    expect(ok.status).toBe(204);

    // Next read should reflect the pushed origin.
    const after = await client.readResource({
      uri: "ui://widget/origin-probe.html",
    });
    const csp = (after as any).contents?.[0]?._meta?.ui?.csp as Record<
      string,
      string[]
    >;
    const all = [
      ...(csp?.resourceDomains ?? []),
      ...(csp?.connectDomains ?? []),
      ...(csp?.baseUriDomains ?? []),
    ];
    expect(all).toContain("https://added.example.com");

    // Bad signature.
    const bad = await server.app.request(
      "http://localhost/mcp-use/internal/origins/refresh",
      {
        method: "POST",
        headers: {
          Host: `localhost:${PORT}`,
          "Content-Type": "application/json",
          "X-MCP-Signature": `t=${t},v1=deadbeef`,
        },
        body,
      }
    );
    expect(bad.status).toBe(401);

    // Stale timestamp.
    const staleT = t - 10 * 60;
    const staleSig = createHmac("sha256", WEBHOOK_SECRET)
      .update(`${staleT}.${body}`)
      .digest("hex");
    const stale = await server.app.request(
      "http://localhost/mcp-use/internal/origins/refresh",
      {
        method: "POST",
        headers: {
          Host: `localhost:${PORT}`,
          "Content-Type": "application/json",
          "X-MCP-Signature": `t=${staleT},v1=${staleSig}`,
        },
        body,
      }
    );
    expect(stale.status).toBe(401);
  });
});
