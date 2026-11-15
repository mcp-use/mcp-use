import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import {
  InMemoryResponseCacheStore,
  SUBSCRIPTION_ID_META_KEY,
  type ResponseCacheStore,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";
import { deferred } from "../../helpers/deferred.js";

async function fixture(responseCacheStore?: ResponseCacheStore) {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {});
  const state = {
    header: "Old" as string | null,
    calls: [] as Array<{
      headers: Record<string, string | string[] | undefined>;
      args: unknown;
    }>,
    executions: 0,
    lists: 0,
    callErrors: [] as number[],
    listError: undefined as number | undefined,
    beforeList: undefined as (() => Promise<void>) | undefined,
    notifyToolsChanged: undefined as (() => void) | undefined,
  };
  const release = deferred();

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    const reply = (result: object) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { resultType: "complete", ...result },
        })
      );
    };
    const fail = (code: number) => {
      response.writeHead(code === -32020 ? 400 : 200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code,
            message: `Fixture ${message.method} rejected: ${code}`,
          },
        })
      );
    };
    if (message.method === "server/discover") {
      reply({
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: { listChanged: true } },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "rotating-header",
            version: "1.0.0",
          },
        },
      });
    } else if (message.method === "subscriptions/listen") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (method: string, params: object = {}) =>
        response.write(
          `data: ${JSON.stringify({
            jsonrpc: "2.0",
            method,
            params: {
              ...params,
              _meta: { [SUBSCRIPTION_ID_META_KEY]: message.id },
            },
          })}\n\n`
        );
      emit("notifications/subscriptions/acknowledged", {
        notifications: message.params.notifications,
      });
      state.notifyToolsChanged = () =>
        void emit("notifications/tools/list_changed");
    } else if (message.method === "tools/list") {
      state.lists++;
      const header = state.header;
      if (state.beforeList) {
        await Promise.race([state.beforeList(), release.promise]);
      }
      if (state.listError !== undefined) return fail(state.listError);
      reply({
        ttlMs: 60000,
        cacheScope: "private",
        tools: [
          {
            name: "write",
            inputSchema: {
              type: "object",
              required: ["value"],
              properties: {
                value: {
                  type: "string",
                  ...(header === null ? {} : { "x-mcp-header": header }),
                },
              },
            },
          },
        ],
      });
    } else if (message.method === "tools/call") {
      state.calls.push({
        headers: Object.fromEntries(
          Object.entries(request.headers).filter(
            ([name]) => name.startsWith("mcp-param-") || name === "x-trace"
          )
        ),
        args: message.params.arguments,
      });
      const error = state.callErrors.shift();
      if (error !== undefined) return fail(error);
      if (
        state.header !== null &&
        request.headers[`mcp-param-${state.header.toLowerCase()}`] !==
          message.params.arguments.value
      )
        return fail(-32020);
      state.executions++;
      reply({ content: [{ type: "text", text: "written" }] });
    } else {
      fail(-32601);
    }
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
    protocolNegotiation: { pin: "2026-07-28" },
    detectMixedAuth: false,
    clientOptions: { responseCacheStore },
  });
  onTestFinished(async () => {
    release.resolve();
    try {
      await connector.disconnect();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  await connector.connect();
  await connector.initialize();
  await connector.callTool("write", { value: "initial" });
  expect(state.executions).toBe(1);
  state.executions = 0;
  state.calls.length = 0;
  state.lists = 0;
  return { connector, state };
}

afterEach(() => vi.unstubAllGlobals());

describe("browser tool schema recovery over HTTP", () => {
  it("refreshes a stale header once, executes once, and keeps the new schema", async () => {
    const { connector, state } = await fixture();
    state.header = "New";
    const result = await connector.callTool("write", { value: "first" });
    expect(result.content).toEqual([{ type: "text", text: "written" }]);
    expect(state.executions).toBe(1);
    expect(state.lists).toBe(1);
    expect(state.calls).toEqual([
      { headers: { "mcp-param-old": "first" }, args: { value: "first" } },
      { headers: { "mcp-param-new": "first" }, args: { value: "first" } },
    ]);
    await connector.callTool("write", { value: "second" });
    expect(state.calls[2]).toEqual({
      headers: { "mcp-param-new": "second" },
      args: { value: "second" },
    });
    expect(state.executions).toBe(2);
    expect(state.lists).toBe(1);
  });

  it("uses explicitly rediscovered tools without a failed tool call", async () => {
    const { connector, state } = await fixture();
    state.header = "New";
    const tools = await connector.listTools();
    expect(tools[0].inputSchema.properties).toEqual({
      value: { type: "string", "x-mcp-header": "New" },
    });
    await connector.callTool("write", { value: "updated" });
    expect(state.calls).toEqual([
      {
        headers: { "mcp-param-new": "updated" },
        args: { value: "updated" },
      },
    ]);
    expect(state.lists).toBe(1);
    expect(state.executions).toBe(1);
  });

  it("removes an old generated header while preserving caller options", async () => {
    const { connector, state } = await fixture();
    state.header = "New";
    const headers = Object.freeze({ "X-Trace": "trace-1" });
    const options = Object.freeze({ headers, timeout: 5000 });
    await connector.callTool("write", { value: "payload" }, options);
    expect(state.calls.map((call) => call.headers)).toEqual([
      { "x-trace": "trace-1", "mcp-param-old": "payload" },
      { "x-trace": "trace-1", "mcp-param-new": "payload" },
    ]);
    expect(options).toEqual({
      headers: { "X-Trace": "trace-1" },
      timeout: 5000,
    });
  });

  it("drops generated headers when rediscovery removes the annotation", async () => {
    const { connector, state } = await fixture();
    state.header = null;
    state.callErrors = [-32020];
    await connector.callTool("write", { value: "plain" });
    expect(state.calls.map((call) => call.headers)).toEqual([
      { "mcp-param-old": "plain" },
      {},
    ]);
    expect(state.executions).toBe(1);
    expect(state.lists).toBe(1);
  });

  it("returns a second mismatch without another refresh or execution", async () => {
    const { connector, state } = await fixture();
    state.header = "New";
    state.callErrors = [-32020, -32020];
    await expect(
      connector.callTool("write", { value: "retry" })
    ).rejects.toMatchObject({ code: -32020 });
    expect(state.calls).toHaveLength(2);
    expect(state.lists).toBe(1);
    expect(state.executions).toBe(0);
  });

  it.each([-32602, -32603])(
    "does not retry protocol error %s",
    async (code) => {
      const { connector, state } = await fixture();
      state.callErrors = [code];
      await expect(
        connector.callTool("write", { value: "bad" })
      ).rejects.toMatchObject({ code });
      expect(state.calls).toHaveLength(1);
      expect(state.lists).toBe(0);
      expect(state.executions).toBe(0);
    }
  );

  it("preserves a failed discovery and allows a later recovery", async () => {
    const { connector, state } = await fixture();
    state.header = "New";
    state.listError = -32603;
    await expect(
      connector.callTool("write", { value: "blocked" })
    ).rejects.toMatchObject({ code: -32603 });
    expect(state.calls).toHaveLength(1);
    expect(state.executions).toBe(0);
    state.listError = undefined;
    await connector.callTool("write", { value: "recovered" });
    expect(state.calls).toHaveLength(3);
    expect(state.executions).toBe(1);
  });

  it("cancels a blocked refresh without retrying the tool", async () => {
    const { connector, state } = await fixture();
    state.header = "New";
    const started = deferred();
    const gate = deferred();
    state.beforeList = () => {
      started.resolve();
      return gate.promise;
    };
    const controller = new AbortController();
    const outcome = connector
      .callTool(
        "write",
        { value: "cancelled" },
        {
          signal: controller.signal,
        }
      )
      .catch((error: unknown) => error);
    await Promise.race([
      started.promise,
      outcome.then(() => {
        throw new Error("Call ended before schema refresh");
      }),
    ]);
    controller.abort();
    expect(await outcome).toMatchObject({ code: "REQUEST_TIMEOUT" });
    gate.resolve();
    expect(state.calls).toHaveLength(1);
    expect(state.executions).toBe(0);
  });

  it("keeps the reconnected schema when an earlier refresh completes", async () => {
    const memory = new InMemoryResponseCacheStore();
    const started = deferred();
    const gate = deferred();
    onTestFinished(() => gate.resolve());
    let pauseWrite = false;
    // An asynchronous store can finish persisting a fetched response after
    // disconnect. Gate its acknowledgement, after the HTTP request completes.
    const store: ResponseCacheStore = {
      get: (key) => memory.get(key),
      delete: (key) => memory.delete(key),
      evict: (method) => memory.evict(method),
      clear: () => memory.clear(),
      set: async (key, entry) => {
        const stamp = memory.set(key, entry);
        if (pauseWrite && key.method === "tools/list") {
          pauseWrite = false;
          started.resolve();
          await gate.promise;
        }
        return stamp;
      },
    };
    const { connector, state } = await fixture(store);
    state.header = "Retired";
    pauseWrite = true;
    const outcome = connector
      .callTool("write", { value: "retired" })
      .catch((error: unknown) => error);
    await Promise.race([
      started.promise,
      outcome.then(() => {
        throw new Error("Call ended before schema persistence");
      }),
    ]);
    await connector.disconnect();
    state.header = "Current";
    await connector.connect();
    await connector.listTools();
    gate.resolve();
    expect(await outcome).toMatchObject({ code: -32020 });
    expect(connector.tools[0].inputSchema.properties).toEqual({
      value: { type: "string", "x-mcp-header": "Current" },
    });
    expect(state.calls).toHaveLength(1);
    await connector.callTool("write", { value: "current" });
    expect(state.calls[1]).toEqual({
      headers: { "mcp-param-current": "current" },
      args: { value: "current" },
    });
    expect(state.executions).toBe(1);
    expect(state.lists).toBe(2);
  });

  it("keeps a notified schema when an older explicit discovery completes", async () => {
    const { connector, state } = await fixture();
    const started = deferred();
    const gate = deferred();
    const notified = deferred();
    connector.onNotification((notification) => {
      if (notification.method === "notifications/tools/list_changed")
        notified.resolve();
    });
    state.beforeList = () => {
      state.beforeList = undefined;
      started.resolve();
      return gate.promise;
    };
    const oldDiscovery = connector.listTools();
    await started.promise;
    state.header = "New";
    state.notifyToolsChanged!();
    await notified.promise;
    gate.resolve();
    expect((await oldDiscovery)[0].inputSchema.properties).toEqual({
      value: { type: "string", "x-mcp-header": "Old" },
    });
    expect(connector.tools[0].inputSchema.properties).toEqual({
      value: { type: "string", "x-mcp-header": "New" },
    });
    await connector.callTool("write", { value: "notified" });
    expect(state.calls).toEqual([
      {
        headers: { "mcp-param-new": "notified" },
        args: { value: "notified" },
      },
    ]);
    expect(state.lists).toBe(2);
    expect(state.executions).toBe(1);
  });
});
