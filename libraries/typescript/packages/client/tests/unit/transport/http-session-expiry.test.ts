import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";

/**
 * A stateful 2025-era Streamable HTTP server. `restart()` forgets every
 * session, as a redeployed or restarted server does. Requests that carry a
 * forgotten Mcp-Session-Id get 404, which the spec reserves for this case.
 */
async function legacyServer() {
  const issued: string[] = [];
  const live = new Set<string>();
  let keepSessions = true;
  const calls: Array<{ method: string; session: string | undefined }> = [];

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const session = request.headers["mcp-session-id"] as string | undefined;
    if (request.method === "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.method === "DELETE") {
      if (session && live.delete(session)) response.writeHead(200).end();
      else response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push({ method: message.method, session });

    if (message.method === "initialize") {
      const id = `session-${issued.length + 1}`;
      issued.push(id);
      if (keepSessions) live.add(id);
      response.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": id,
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "stateful-fixture", version: "1.0.0" },
          },
        })
      );
      return;
    }
    if (!session || !live.has(session)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id ?? null,
          error: { code: -32001, message: "Session not found" },
        })
      );
      return;
    }
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const result =
      message.method === "tools/list"
        ? {
            tools: [{ name: "whoami", inputSchema: { type: "object" } }],
          }
        : message.method === "tools/call"
          ? { content: [{ type: "text", text: session }] }
          : {};
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: Error) =>
      response.destroy(error)
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const connector = new HttpConnector(`http://127.0.0.1:${address.port}/mcp`, {
    protocolNegotiation: "legacy",
    timeout: 5000,
  });
  onTestFinished(async () => {
    try {
      await connector.disconnect();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  return {
    connector,
    issued,
    calls,
    restart: () => live.clear(),
    /** Issue sessions but recognise none of them afterwards. */
    forgetEverySession: () => {
      keepSessions = false;
      live.clear();
    },
  };
}

function text(result: { content: unknown }): string {
  return (result.content as Array<{ text: string }>)[0]!.text;
}

describe("HTTP connector when the server forgets a legacy session", () => {
  it("starts a new session and retries the request once after a 404", async () => {
    const server = await legacyServer();
    const { connector } = server;
    await connector.connect();
    await connector.initialize();
    expect(text(await connector.callTool("whoami", {}))).toBe("session-1");

    server.restart();

    expect(text(await connector.callTool("whoami", {}))).toBe("session-2");
    expect(server.issued).toEqual(["session-1", "session-2"]);
    expect(server.calls.filter((call) => call.method === "tools/call")).toEqual(
      [
        { method: "tools/call", session: "session-1" },
        { method: "tools/call", session: "session-1" },
        { method: "tools/call", session: "session-2" },
      ]
    );
    expect(connector.tools.map((tool) => tool.name)).toEqual(["whoami"]);
    expect(text(await connector.callTool("whoami", {}))).toBe("session-2");
  }, 10_000);

  it("opens one new session for concurrent requests that hit the expired one", async () => {
    const server = await legacyServer();
    const { connector } = server;
    await connector.connect();
    await connector.initialize();

    server.restart();

    const results = await Promise.all([
      connector.callTool("whoami", {}),
      connector.callTool("whoami", {}),
      connector.callTool("whoami", {}),
    ]);
    expect(results.map(text)).toEqual(["session-2", "session-2", "session-2"]);
    expect(server.issued).toEqual(["session-1", "session-2"]);
  }, 10_000);

  it("makes one attempt to replace the session and then reports failure", async () => {
    const server = await legacyServer();
    const { connector } = server;
    await connector.connect();
    await connector.initialize();

    server.forgetEverySession();

    await expect(connector.callTool("whoami", {})).rejects.toThrow();
    expect(server.issued).toEqual(["session-1", "session-2"]);
    expect(connector.isClientConnected).toBe(false);
  }, 10_000);
});
