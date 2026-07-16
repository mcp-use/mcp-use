/**
 * End-to-end smoke test for the v2 scaffold: a real @modelcontextprotocol/client
 * talks over HTTP to a fetch-native app serving a v2 createMcpHandler endpoint.
 *
 * This intentionally exercises the full stack (client transport → Node HTTP →
 * fetch routing → SDK handler → per-request McpServer factory → tool handler)
 * with zero mocks, proving the scaffold's dependency set actually works
 * together under the stateless protocol.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { composeFetch, jsonBodyMiddleware } from "../src/fetch-app.js";
import { mountMcp, type MountMcpOptions } from "../src/index.js";
import { listenFetch } from "./helpers/listen-fetch.js";

function buildTestServer(): McpServer {
  const server = new McpServer({ name: "scaffold-test", version: "0.0.1" });
  server.registerTool(
    "add",
    {
      description: "Add two numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
    },
    ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    })
  );
  return server;
}

describe("mountMcp", () => {
  let httpServer: Awaited<ReturnType<typeof listenFetch>>;
  let baseUrl: string;

  beforeAll(async () => {
    const { fetch: mcpFetch } = mountMcp(buildTestServer);
    const fetch = composeFetch(mcpFetch, jsonBodyMiddleware());
    httpServer = await listenFetch(fetch);
    baseUrl = httpServer.url;
  });

  afterAll(async () => {
    await httpServer.close();
  });

  async function connectClient(path = "/mcp"): Promise<Client> {
    const client = new Client(
      { name: "scaffold-test-client", version: "0.0.1" },
      // The client's default posture is the legacy 2025 handshake, which the
      // mount rejects (2026-07-28 only) — pin the modern revision.
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    const transport = new StreamableHTTPClientTransport(new URL(path, baseUrl));
    await client.connect(transport);
    return client;
  }

  it("serves tools/list and tools/call end-to-end over HTTP", async () => {
    const client = await connectClient();
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("add");

      const result = await client.callTool({
        name: "add",
        arguments: { a: 2, b: 40 },
      });
      expect(result.content).toEqual([{ type: "text", text: "42" }]);
    } finally {
      await client.close();
    }
  });

  it("builds a fresh server per request: concurrent clients don't share instances", async () => {
    // Stateless model: each HTTP request gets its own McpServer from the
    // factory. Two concurrent clients calling the same endpoint must both
    // succeed independently.
    const [a, b] = await Promise.all([connectClient(), connectClient()]);
    try {
      const [ra, rb] = await Promise.all([
        a.callTool({ name: "add", arguments: { a: 1, b: 2 } }),
        b.callTool({ name: "add", arguments: { a: 3, b: 4 } }),
      ]);
      expect(ra.content).toEqual([{ type: "text", text: "3" }]);
      expect(rb.content).toEqual([{ type: "text", text: "7" }]);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });

  it("answers GET session probe with 204 on stateless mount (not 405)", async () => {
    const response = await fetch(new URL("/mcp", baseUrl), {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    expect(response.status).toBe(204);
  });

  it("answers HEAD health probe with 204 on stateless mount (not 405)", async () => {
    const response = await fetch(new URL("/mcp", baseUrl), { method: "HEAD" });
    expect(response.status).toBe(204);
  });

  it("mounts on a custom path", async () => {
    const options: MountMcpOptions = { path: "/custom/mcp" };
    const { handler, fetch: mcpFetch } = mountMcp(buildTestServer, options);
    const fetch = composeFetch(mcpFetch, jsonBodyMiddleware());
    const started = await listenFetch(fetch);
    try {
      const client = new Client(
        { name: "scaffold-test-client", version: "0.0.1" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } }
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`${started.url}/custom/mcp`)
      );
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(1);
      await client.close();
    } finally {
      await handler.close();
      await started.close();
    }
  });
});
