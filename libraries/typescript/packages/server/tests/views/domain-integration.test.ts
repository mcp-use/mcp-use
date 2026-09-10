import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, registerViews } from "../../src/index.js";

describe("host-specific view domains over HTTP", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["https://example.com", "https://website.example.com"],
    ["https://example.com/mcp", "https://website.example.com"],
    [undefined, "https://website.example.com"],
    ["https://example.com/mcp", "https://website.example.com/mcp"],
  ])(
    "separates endpoint %s from authored UI URL %s",
    async (mcpUrl, domain) => {
      vi.stubEnv("MCP_URL", mcpUrl);
      vi.stubEnv("MCP_ASSETS_URL", "https://cdn.example.com/assets");
      const server = new MCPServer({ name: "domain-test", version: "1.0.0" });
      server[registerViews]({ result: { kind: "inline", js: "", css: "" } });
      server.tool(
        {
          name: "show-result",
          outputSchema: z.object({ ok: z.boolean() }),
          view: {
            name: "result",
            domain,
            prefersBorder: true,
            csp: { frameDomains: ["https://embed.example.com"] },
          },
          // Tool metadata is not a source of resource-domain configuration.
          _meta: {
            ui: { domain: "https://wrong.example/mcp" },
            "openai/widgetDomain": "https://alias.example",
          },
        },
        async () => ({ structuredContent: { ok: true }, content: [] })
      );

      async function request(method: string, clientName: string) {
        const response = await server.fetch(
          new Request("http://127.0.0.1:3000/mcp", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "mcp-protocol-version": "2026-07-28",
              "mcp-method": method,
              ...(method === "resources/read"
                ? { "mcp-name": "ui://views/result.html" }
                : {}),
              forwarded: "proto=https;host=example.com",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method,
              params: {
                ...(method === "resources/read"
                  ? { uri: "ui://views/result.html" }
                  : {}),
                _meta: {
                  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                  "io.modelcontextprotocol/clientInfo": {
                    name: clientName,
                    version: "1.0.0",
                  },
                  "io.modelcontextprotocol/clientCapabilities": {},
                },
              },
            }),
          })
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.error).toBeUndefined();
        return body.result;
      }

      try {
        const listed = await request("resources/list", "ChatGPT");
        expect(listed.resources[0]._meta.ui.domain).toBe(
          "https://website.example.com"
        );
        // Interleave hosts to catch mutation or caching of request-specific values.
        for (const client of ["ChatGPT", "Claude", "ChatGPT"]) {
          const read = await request("resources/read", client);
          const meta = read.contents[0]._meta;
          expect(meta.ui.domain).toBe(
            client === "Claude"
              ? "c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com"
              : "https://website.example.com"
          );
          expect(meta).not.toHaveProperty("openai/widgetDomain");
          expect(meta.ui.prefersBorder).toBe(true);
          expect(meta.ui.csp.frameDomains).toEqual([
            "https://embed.example.com",
          ]);
        }
      } finally {
        await server.close();
      }
    }
  );
});
