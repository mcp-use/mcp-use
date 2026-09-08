import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";
import { deferred } from "../../helpers/deferred.js";

async function fixture() {
  const initializeStarted = deferred();
  const initializeGate = deferred();
  const terminateStarted = deferred();
  const terminateGate = deferred();
  const streamOpened = deferred();
  const streamClosed = deferred();
  const sessions: string[] = [];
  const terminated: Array<string | string[] | undefined> = [];
  const streams = new Set<ServerResponse>();

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      streams.add(response);
      response.once("close", () => {
        streams.delete(response);
        streamClosed.resolve();
      });
      streamOpened.resolve();
      return;
    }
    if (request.method === "DELETE") {
      terminated.push(request.headers["mcp-session-id"]);
      terminateStarted.resolve();
      await terminateGate.promise;
      response.writeHead(200).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (message.method === "initialize") {
      const sessionId = `session-${sessions.length + 1}`;
      sessions.push(sessionId);
      initializeStarted.resolve();
      await initializeGate.promise;
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
            capabilities: {},
            serverInfo: { name: "lifecycle-fixture", version: "1.0.0" },
          },
        })
      );
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
  const connector = new HttpConnector(`http://127.0.0.1:${address.port}/mcp`, {
    protocolNegotiation: "legacy",
    timeout: 5000,
  });
  onTestFinished(async () => {
    initializeGate.resolve();
    terminateGate.resolve();
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
    initializeStarted,
    initializeGate,
    terminateStarted,
    terminateGate,
    streamOpened,
    streamClosed,
    sessions,
    terminated,
    streams,
  };
}

describe("HTTP lifecycle with a real legacy MCP session", () => {
  it("shares one session across concurrent connects and closes its stream on disconnect", async () => {
    const server = await fixture();
    const { connector } = server;

    const connects = Promise.all([
      connector.connect(),
      connector.connect(),
      connector.connect(),
    ]);
    await server.initializeStarted.promise;
    server.initializeGate.resolve();
    await connects;
    await server.streamOpened.promise;
    expect(server.sessions).toEqual(["session-1"]);
    expect(server.streams.size).toBe(1);

    server.terminateGate.resolve();
    await Promise.all([connector.disconnect(), connector.disconnect()]);
    await server.streamClosed.promise;
    expect(server.terminated).toEqual(["session-1"]);
    expect(server.streams.size).toBe(0);
    expect(connector.isClientConnected).toBe(false);
  }, 10_000);

  it("does not create another session when a queued reconnect is cancelled during DELETE", async () => {
    const server = await fixture();
    const { connector } = server;
    server.initializeGate.resolve();
    await connector.connect();
    await server.streamOpened.promise;

    const firstDisconnect = connector.disconnect();
    await server.terminateStarted.promise;
    const reconnect = connector.connect();
    const finalDisconnect = connector.disconnect();
    const cancelled = expect(reconnect).rejects.toThrow(
      "Connection cancelled by disconnect"
    );
    server.terminateGate.resolve();
    await Promise.all([firstDisconnect, finalDisconnect, cancelled]);
    await server.streamClosed.promise;

    expect(server.sessions).toEqual(["session-1"]);
    expect(server.terminated).toEqual(["session-1"]);
    expect(server.streams.size).toBe(0);
    expect(connector.isClientConnected).toBe(false);
  }, 10_000);
});
