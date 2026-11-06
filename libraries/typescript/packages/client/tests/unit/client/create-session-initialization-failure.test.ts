import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { BrowserMCPClient } from "../../../src/core/browser.js";

async function fixture() {
  const sessions: string[] = [];
  const terminated: string[] = [];
  const streams = new Set<ServerResponse>();
  let rejectToolsList = true;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      streams.add(response);
      response.once("close", () => streams.delete(response));
      return;
    }
    if (request.method === "DELETE") {
      terminated.push(request.headers["mcp-session-id"] as string);
      response.writeHead(200).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (message.method === "initialize") {
      const sessionId = `session-${sessions.length + 1}`;
      sessions.push(sessionId);
      response.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "initialization-fixture", version: "1.0.0" },
          },
        })
      );
      return;
    }
    if (message.method === "tools/list") {
      if (rejectToolsList) {
        response.writeHead(401).end("Authentication required");
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: { tools: [] },
          })
        );
      }
      return;
    }
    response.writeHead(202).end();
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
  const client = new BrowserMCPClient({
    mcpServers: {
      server: {
        url: `http://127.0.0.1:${address.port}/mcp`,
        protocolNegotiation: "legacy",
        authProvider: { token: async () => undefined },
      },
    },
  });
  onTestFinished(async () => {
    await client.close();
    // Also release orphaned streams when running against the unfixed client.
    for (const stream of streams) stream.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });
  return {
    client,
    sessions,
    terminated,
    streams,
    allowToolsList: () => {
      rejectToolsList = false;
    },
    rejectToolsList: () => {
      rejectToolsList = true;
    },
  };
}

describe("createSession initialization failure with a real HTTP session", () => {
  it("terminates a connected session when the initial tools/list is unauthorized", async () => {
    const { client, sessions, terminated, streams } = await fixture();

    await expect(client.createSession("server")).rejects.toThrow(
      "Unauthorized"
    );
    expect(client.getSession("server")).toBeNull();
    expect(client.activeSessions).toEqual([]);
    expect(sessions).toEqual(["session-1"]);
    expect(terminated).toEqual(["session-1"]);
    await vi.waitFor(() => expect(streams.size).toBe(0));

    await client.close();
    expect(terminated).toEqual(["session-1"]);
  });

  it("keeps the previous session reachable when its replacement fails to initialize", async () => {
    const server = await fixture();
    server.allowToolsList();
    const previous = await server.client.createSession("server");
    server.rejectToolsList();

    await expect(server.client.createSession("server")).rejects.toThrow(
      "Unauthorized"
    );
    expect(server.client.getSession("server")).toBe(previous);
    expect(previous.isConnected).toBe(true);
    expect(server.client.activeSessions).toEqual(["server"]);
    expect(server.sessions).toEqual(["session-1", "session-2"]);
    expect(server.terminated).toEqual(["session-2"]);
    await vi.waitFor(() => expect(server.streams.size).toBe(1));

    await server.client.close();
    expect(server.terminated).toEqual(["session-2", "session-1"]);
    await vi.waitFor(() => expect(server.streams.size).toBe(0));
  });
});
