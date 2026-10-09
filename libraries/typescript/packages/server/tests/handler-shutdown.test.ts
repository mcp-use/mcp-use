import {
  InMemoryServerEventBus,
  McpServer,
  Server,
  type McpServerFactory,
  type ServerEvent,
  type ServerEventBus,
  type Transport,
} from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getRequestBag } from "../src/fetch-app.js";
import { createMcpMount } from "../src/mount-mcp.js";
import { MCPServer } from "../src/server.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Lifecycle operation stalled")),
          1000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function request(
  method = "tools/list",
  params: Record<string, unknown> = {},
  modern = true,
  signal?: AbortSignal
): Request {
  return new Request("http://lifecycle.invalid/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": modern ? "2026-07-28" : "2025-11-25",
      ...(modern && {
        "mcp-method": method,
        ...(method === "tools/call" && { "mcp-name": String(params.name) }),
      }),
    },
    ...(signal !== undefined && { signal }),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          ...(modern && {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "lifecycle-test",
              version: "1",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          }),
          progressToken: "lifecycle-progress",
        },
      },
    }),
  });
}

function buildServer(): Server {
  return new Server(
    { name: "lifecycle-test", version: "1" },
    { capabilities: { tools: { listChanged: true } } }
  );
}

const listenRequest = () =>
  request("subscriptions/listen", {
    notifications: { toolsListChanged: true },
  });

describe("MCP handler shutdown", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["modern ordinary", () => request()],
    ["legacy ordinary", () => request("tools/list", {}, false)],
    ["modern subscription", listenRequest],
  ])(
    "cancels a pending %s factory, then disposes its late result",
    async (_name, makeRequest) => {
      const entered = deferred();
      const gate = deferred<Server>();
      const server = buildServer();
      const close = vi.spyOn(server, "close");
      const connect = vi.spyOn(server, "connect");
      const bus = new InMemoryServerEventBus();
      const mount = createMcpMount(
        async () => {
          entered.resolve();
          return gate.promise;
        },
        { handler: { bus } }
      );
      const pending = mount.fetch(makeRequest());
      await bounded(entered.promise);
      await bounded(mount.handler.close());
      expect((await bounded(pending)).status).toBe(499);
      gate.resolve(server);
      await tick();
      expect(connect).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
      expect(bus.listenerCount).toBe(0);
      await expect(mount.handler.fetch(request())).rejects.toThrow("closed");
    }
  );

  it("does not wait for a factory that never settles", async () => {
    const entered = deferred();
    const mount = createMcpMount(() => {
      entered.resolve();
      return new Promise<Server>(() => {});
    });
    const pending = mount.fetch(request());
    await bounded(entered.promise);
    await bounded(mount.handler.close());
    expect((await bounded(pending)).status).toBe(499);
    await bounded(mount.handler.close());
  });

  it("observes a factory rejection after shutdown", async () => {
    const entered = deferred();
    const gate = deferred<Server>();
    const onerror = vi.fn();
    const mount = createMcpMount(
      () => {
        entered.resolve();
        return gate.promise;
      },
      { handler: { onerror } }
    );
    const pending = mount.fetch(request());
    await bounded(entered.promise);
    await mount.handler.close();
    expect((await pending).status).toBe(499);
    const error = new Error("late factory rejection");
    gate.reject(error);
    await tick();
    expect(onerror).toHaveBeenCalledWith(error);
  });

  it.each([true, false])(
    "does not revive a delayed connect in modern=%s",
    async (modern) => {
      const entered = deferred<Transport>();
      const gate = deferred();
      const server = buildServer();
      const originalConnect = server.connect.bind(server);
      vi.spyOn(server, "connect").mockImplementation(async (transport) => {
        entered.resolve(transport);
        await gate.promise;
        await originalConnect(transport);
      });
      const mount = createMcpMount(() => server);
      const pending = mount.fetch(request("tools/list", {}, modern));
      const transport = await bounded(entered.promise);
      const closeTransport = vi.spyOn(transport, "close");
      await bounded(mount.handler.close());
      expect((await bounded(pending)).status).toBe(499);
      expect(closeTransport).toHaveBeenCalled();
      gate.resolve();
      await tick();
      expect(server.transport).toBeUndefined();
      expect(closeTransport.mock.calls.length).toBeGreaterThan(1);
    }
  );

  it("cleans the transport even if product disposal fails", async () => {
    const entered = deferred<Transport>();
    const gate = deferred();
    const server = buildServer();
    const originalConnect = server.connect.bind(server);
    vi.spyOn(server, "connect").mockImplementation(async (transport) => {
      entered.resolve(transport);
      await gate.promise;
      await originalConnect(transport);
    });
    const error = new Error("product close failed");
    vi.spyOn(server, "close").mockRejectedValue(error);
    const onerror = vi.fn();
    const mount = createMcpMount(() => server, { handler: { onerror } });
    const pending = mount.fetch(request("tools/list", {}, false));
    const transport = await bounded(entered.promise);
    const closeTransport = vi.spyOn(transport, "close");
    await bounded(mount.handler.close());
    expect((await pending).status).toBe(499);
    expect(closeTransport).toHaveBeenCalled();
    expect(onerror).toHaveBeenCalledWith(error);
    gate.resolve();
    await tick();
    expect(server.transport).toBeUndefined();
  });

  it.each([true, false])(
    "aborts active SSE tools and clears heartbeats in modern=%s",
    async (modern) => {
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const gate = deferred();
      let toolSignal: AbortSignal | undefined;
      const server = new MCPServer({
        name: "lifecycle-stream",
        version: "1",
        skills: false,
        logging: { enabled: false },
      });
      server.tool({ name: "wait" }, async (_args, context) => {
        toolSignal = context.signal;
        await context.reportProgress(1, 2, "waiting");
        await gate.promise;
        return { content: [{ type: "text", text: "done" }] };
      });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const reply = await bounded(
          server.fetch(request("tools/call", { name: "wait" }, modern))
        );
        expect(reply.headers.get("content-type")).toContain(
          "text/event-stream"
        );
        reader = reply.body!.getReader();
        expect((await bounded(reader.read())).done).toBe(false);
        expect(toolSignal?.aborted).toBe(false);
        const timers = setIntervalSpy.mock.results.map(
          (result) => result.value
        );
        expect(timers.length).toBeGreaterThan(0);
        await bounded(server.close());
        expect(toolSignal?.aborted).toBe(true);
        for (const timer of timers)
          expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
        while (!(await bounded(reader.read())).done) {
          /* Drain an already buffered frame. */
        }
      } finally {
        gate.resolve();
        await reader?.cancel();
        await server.close();
      }
    }
  );

  it.each([true, false])(
    "releases active SSE on client abort in modern=%s",
    async (modern) => {
      const gate = deferred();
      const abort = new AbortController();
      let toolSignal: AbortSignal | undefined;
      const server = new MCPServer({
        name: "abort-stream",
        version: "1",
        skills: false,
        logging: { enabled: false },
      });
      server.tool({ name: "wait" }, async (_args, context) => {
        toolSignal = context.signal;
        await context.reportProgress(1, 2);
        await gate.promise;
        return { content: [{ type: "text", text: "done" }] };
      });
      try {
        const reply = await bounded(
          server.fetch(
            request("tools/call", { name: "wait" }, modern, abort.signal)
          )
        );
        const reader = reply.body!.getReader();
        await bounded(reader.read());
        abort.abort();
        expect(toolSignal?.aborted).toBe(true);
        while (!(await bounded(reader.read())).done) {
          /* Drain buffered frames. */
        }
      } finally {
        gate.resolve();
        await server.close();
      }
    }
  );

  it("preserves request middleware values and the finite JSON reply", async () => {
    let factoryRequest: Request | undefined;
    const server = new McpServer({ name: "finite-reply", version: "1" });
    server.registerTool("finite", {}, () => ({
      content: [{ type: "text", text: "done" }],
    }));
    const factory: McpServerFactory = (context) => {
      factoryRequest = context.requestInfo;
      return server;
    };
    const mount = createMcpMount(factory);
    const original = request();
    const body = await original.clone().json();
    getRequestBag(original).parsedBody = body;
    const reply = await mount.fetch(original);
    expect(reply.status).toBe(200);
    expect(reply.headers.get("content-type")).toContain("application/json");
    expect(getRequestBag(factoryRequest!).parsedBody).toBe(body);
    expect((await reply.json()).result.tools[0].name).toBe("finite");
    await mount.handler.close();
  });

  it.each([
    [true, "eof"],
    [false, "eof"],
    [true, "cancel"],
    [false, "cancel"],
  ])("cleans active SSE on %s/%s", async (modern, end) => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const gate = deferred();
    let toolSignal: AbortSignal | undefined;
    const server = new MCPServer({
      name: "stream-completion",
      version: "1",
      skills: false,
      logging: { enabled: false },
    });
    server.tool({ name: "wait" }, async (_args, context) => {
      toolSignal = context.signal;
      await context.reportProgress(1, 2);
      await gate.promise;
      return { content: [{ type: "text", text: "done" }] };
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const reply = await bounded(
        server.fetch(request("tools/call", { name: "wait" }, modern))
      );
      reader = reply.body!.getReader();
      await bounded(reader.read());
      const timers = setIntervalSpy.mock.results.map((result) => result.value);
      if (end === "cancel") await bounded(reader.cancel());
      else {
        gate.resolve();
        let frames = "";
        while (true) {
          const result = await bounded(reader.read());
          if (result.done) break;
          frames += new TextDecoder().decode(result.value);
        }
        expect(frames).toContain("done");
      }
      expect(toolSignal?.aborted).toBe(true);
      for (const timer of timers)
        expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    } finally {
      gate.resolve();
      await reader?.cancel();
      await server.close();
    }
  });

  it("cancels a client-aborted pending factory and disposes its late result", async () => {
    const entered = deferred();
    const gate = deferred<Server>();
    const abort = new AbortController();
    const late = buildServer();
    const connect = vi.spyOn(late, "connect");
    const close = vi.spyOn(late, "close");
    const mount = createMcpMount(() => {
      entered.resolve();
      return gate.promise;
    });
    const pending = mount.fetch(request("tools/list", {}, true, abort.signal));
    await bounded(entered.promise);
    abort.abort();
    expect((await bounded(pending)).status).toBe(499);
    gate.resolve(late);
    await tick();
    expect(close).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    await mount.handler.close();
  });

  it("releases default-bus subscriptions on body cancellation", async () => {
    const mount = createMcpMount(buildServer);
    const bus = mount.handler.bus as InMemoryServerEventBus;
    const response = await mount.fetch(listenRequest());
    const reader = response.body!.getReader();
    await reader.read();
    expect(bus.listenerCount).toBe(1);
    await reader.cancel();
    expect(bus.listenerCount).toBe(0);
    await mount.handler.close();
  });

  it("makes retained custom-bus callbacks inert and retries failed unsubscribe", async () => {
    const callbacks = new Set<(event: ServerEvent) => void>();
    const outside = vi.fn();
    callbacks.add(outside);
    let fail = true;
    const unsubscribe = vi.fn();
    const bus: ServerEventBus = {
      publish(event) {
        for (const callback of callbacks) callback(event);
      },
      subscribe(callback) {
        callbacks.add(callback);
        return () => {
          unsubscribe();
          if (fail) throw new Error("backend unsubscribe failed");
          callbacks.delete(callback);
        };
      },
    };
    const onerror = vi.fn();
    const mount = createMcpMount(buildServer, { handler: { bus, onerror } });
    const response = await mount.fetch(listenRequest());
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    await mount.handler.close();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(2);
    expect(onerror).toHaveBeenCalledTimes(2);
    mount.handler.notify.toolsChanged();
    expect(outside).toHaveBeenCalledTimes(1);
    expect((await reader.read()).done).toBe(true);
    fail = false;
    await mount.handler.close();
    expect(unsubscribe).toHaveBeenCalledTimes(3);
    expect(callbacks).toEqual(new Set([outside]));
  });
});
