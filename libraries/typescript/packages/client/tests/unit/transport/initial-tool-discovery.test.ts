import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { BrowserMCPClient } from "../../../src/core/browser.js";

type Listing =
  | "tools"
  | "empty"
  | "unsupported"
  | "internal"
  | "http"
  | "closed"
  | "timeout";

async function fixture(listing: Listing = "tools", resourcesOnly = false) {
  const state = { listing, toolRequests: 0, sessions: 0 };
  const tool = {
    name: "ping",
    description: "Return a fixed response",
    inputSchema: { type: "object", properties: {} },
  };
  const owned: { client?: BrowserMCPClient } = {};

  async function handle(request: IncomingMessage, response: ServerResponse) {
    // Standalone server-to-client SSE streams are optional for this fixture.
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(200).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: number | string;
      method: string;
    };
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const reply = (payload: object) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, ...payload })
      );
    };
    if (message.method === "initialize") {
      response.setHeader("mcp-session-id", `fixture-${++state.sessions}`);
      reply({
        result: {
          protocolVersion: "2025-11-25",
          capabilities: resourcesOnly ? { resources: {} } : { tools: {} },
          serverInfo: { name: "discovery-fixture", version: "1.0.0" },
        },
      });
    } else if (message.method === "tools/list") {
      state.toolRequests++;
      if (state.listing === "timeout") return;
      if (state.listing === "closed") {
        response.destroy();
      } else if (state.listing === "http") {
        response.writeHead(503).end("Tool registry unavailable");
      } else if (
        state.listing === "internal" ||
        state.listing === "unsupported"
      ) {
        reply({
          error: {
            code: state.listing === "internal" ? -32603 : -32601,
            message: "Tool registry unavailable",
            data: { operation: "tools/list" },
          },
        });
      } else {
        reply({ result: { tools: state.listing === "empty" ? [] : [tool] } });
      }
    } else if (message.method === "tools/call") {
      reply({ result: { content: [{ type: "text", text: "pong" }] } });
    } else if (message.method === "resources/read") {
      reply({
        result: { contents: [{ uri: "fixture://status", text: "available" }] },
      });
    } else {
      reply({ error: { code: -32601, message: "Method not found" } });
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: Error) =>
      response.destroy(error)
    );
  });
  onTestFinished(async () => {
    try {
      await owned.client?.close();
    } finally {
      // Failed auto-initialization can leave an unpublished transport (#2804).
      server.closeAllConnections();
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const client = new BrowserMCPClient({
    mcpServers: {
      fixture: {
        url: `http://127.0.0.1:${address.port}/mcp`,
        protocolNegotiation: "legacy",
        oauth: false,
        reconnectionOptions: { maxRetries: 0 },
        defaultRequestOptions: { timeout: listing === "timeout" ? 250 : 5000 },
      },
    },
  });
  owned.client = client;
  return { client, state };
}

describe("initial tool discovery through a real HTTP server", () => {
  it("rejects a server error instead of publishing an empty-tool session", async () => {
    const { client, state } = await fixture("internal");
    await expect(client.createSession("fixture")).rejects.toMatchObject({
      code: -32603,
      data: { operation: "tools/list" },
    });
    expect(client.getSession("fixture")).toBeNull();
    expect(client.activeSessions).toEqual([]);
    expect(state.toolRequests).toBe(1);
  });

  it.each([
    ["http", { status: 503 }],
    ["timeout", { code: "REQUEST_TIMEOUT" }],
  ] as const)("propagates %s discovery failures", async (listing, error) => {
    const { client, state } = await fixture(listing);
    await expect(client.createSession("fixture")).rejects.toMatchObject(error);
    expect(client.getSession("fixture")).toBeNull();
    expect(state.toolRequests).toBe(1);
  });

  it("rejects when the server disconnects during discovery", async () => {
    const { client, state } = await fixture("closed");
    await expect(client.createSession("fixture")).rejects.toBeInstanceOf(Error);
    expect(client.getSession("fixture")).toBeNull();
    expect(state.toolRequests).toBe(1);
  });

  it("initializes a resources-only server without sending tools/list", async () => {
    const { client, state } = await fixture("internal", true);
    const session = await client.createSession("fixture");
    expect(session.tools).toEqual([]);
    expect(state.toolRequests).toBe(0);
    await expect(
      session.readResource("fixture://status")
    ).resolves.toMatchObject({
      contents: [{ uri: "fixture://status", text: "available" }],
    });
  });

  it.each(["empty", "unsupported"] as const)(
    "accepts %s tool discovery as an empty list",
    async (listing) => {
      const { client, state } = await fixture(listing);
      const session = await client.createSession("fixture");
      expect(session.tools).toEqual([]);
      expect(client.getSession("fixture")).toBe(session);
      expect(state.toolRequests).toBe(1);
    }
  );

  it("discovers and calls a tool after an explicit retry", async () => {
    const { client, state } = await fixture("internal");
    const session = await client.createSession("fixture", false);
    await expect(session.initialize()).rejects.toMatchObject({ code: -32603 });
    expect(() => session.tools).toThrow();
    state.listing = "tools";
    await session.initialize();
    expect(session.tools.map((tool) => tool.name)).toEqual(["ping"]);
    expect(state.toolRequests).toBe(2);
    expect(state.sessions).toBe(1);
    await expect(session.callTool("ping", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "pong" }],
    });
  });

  it("keeps a healthy session available when replacement discovery fails", async () => {
    const { client, state } = await fixture();
    const previous = await client.createSession("fixture");
    expect(previous.tools.map((tool) => tool.name)).toEqual(["ping"]);
    state.listing = "internal";
    await expect(client.createSession("fixture")).rejects.toMatchObject({
      code: -32603,
    });
    expect(client.getSession("fixture")).toBe(previous);
    expect(client.activeSessions).toEqual(["fixture"]);
    expect(state.toolRequests).toBe(2);
    await expect(previous.callTool("ping", {})).resolves.toMatchObject({
      content: [{ type: "text", text: "pong" }],
    });
  });
});
