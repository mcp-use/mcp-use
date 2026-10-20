import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MockInstance } from "vitest";

import { flush, instrument, shutdown } from "../src/index.js";
import { globalState } from "../src/state.js";
import { registerV1Fixture } from "./helpers/fixtures-v1.js";
import { startIngest } from "./helpers/ingest.js";
import { byMethod, resetAnalytics } from "./helpers/state.js";

const INSTRUMENTED = Symbol.for("@mcp-use/analytics.instrumented");

function handlerMap(server: McpServer): Map<string, unknown> {
  return (
    server.server as unknown as { _requestHandlers: Map<string, unknown> }
  )._requestHandlers;
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await resetAnalytics();
});

function warnings(): string[] {
  return warn.mock.calls.map(([message]) => String(message));
}

describe("configuration", () => {
  it("is a no-op with one warning when no key is configured", () => {
    const server = new McpServer({ name: "s", version: "1" });
    const before = new Map(handlerMap(server));
    expect(instrument(server)).toBe(server);
    instrument(new McpServer({ name: "t", version: "1" }));
    expect(
      warnings().filter((m) => m.includes("MANUFACT_ANALYTICS_KEY"))
    ).toHaveLength(1);
    expect(
      (server as unknown as Record<symbol, unknown>)[INSTRUMENTED]
    ).toBeUndefined();
    expect(handlerMap(server)).toEqual(before);
    expect(globalState().clients.size).toBe(0);
  });

  it("reads the key and endpoint from the environment", () => {
    vi.stubEnv("MANUFACT_ANALYTICS_KEY", "mfi_from_env");
    vi.stubEnv("MANUFACT_ANALYTICS_URL", "https://ingest.example.test");
    instrument(new McpServer({ name: "s", version: "1" }));
    const [client] = [...globalState().clients.values()];
    expect(client?.settings.apiKey).toBe("mfi_from_env");
    expect(client?.settings.endpoint).toBe("https://ingest.example.test");
    expect(warnings()).toHaveLength(0);
  });

  it("defaults to the production ingest endpoint", () => {
    vi.stubEnv("MANUFACT_ANALYTICS_URL", "");
    instrument(new McpServer({ name: "s", version: "1" }), { apiKey: "mfi_k" });
    expect([...globalState().clients.values()][0]?.settings.endpoint).toBe(
      "https://ingest.run.mcp-use.com"
    );
  });

  it("options win over the environment", () => {
    vi.stubEnv("MANUFACT_ANALYTICS_KEY", "mfi_env");
    instrument(new McpServer({ name: "s", version: "1" }), {
      apiKey: "mfi_option",
      endpoint: "https://option.test",
      flushIntervalMs: 5,
      maxBatchSize: 9999,
      maxQueueSize: 0,
    });
    const settings = [...globalState().clients.values()][0]?.settings;
    expect(settings).toMatchObject({
      apiKey: "mfi_option",
      endpoint: "https://option.test",
      flushIntervalMs: 5,
      maxBatchSize: 500,
      maxQueueSize: 1,
    });
  });

  it.each(["1", "true", "TRUE", "yes", "on"])(
    "MANUFACT_ANALYTICS_DISABLED=%s turns it off silently",
    (value) => {
      vi.stubEnv("MANUFACT_ANALYTICS_DISABLED", value);
      const server = new McpServer({ name: "s", version: "1" });
      instrument(server, { apiKey: "mfi_k" });
      expect(
        (server as unknown as Record<symbol, unknown>)[INSTRUMENTED]
      ).toBeUndefined();
      expect(warnings()).toHaveLength(0);
    }
  );

  it("enabled overrides MANUFACT_ANALYTICS_DISABLED", () => {
    vi.stubEnv("MANUFACT_ANALYTICS_DISABLED", "true");
    const server = new McpServer({ name: "s", version: "1" });
    instrument(server, { apiKey: "mfi_k", enabled: true });
    expect((server as unknown as Record<symbol, unknown>)[INSTRUMENTED]).toBe(
      true
    );
    const off = new McpServer({ name: "s", version: "1" });
    instrument(off, { apiKey: "mfi_k", enabled: false });
    expect(
      (off as unknown as Record<symbol, unknown>)[INSTRUMENTED]
    ).toBeUndefined();
  });

  it("warns about an invalid endpoint and records nothing", () => {
    const server = new McpServer({ name: "s", version: "1" });
    instrument(server, { apiKey: "mfi_k", endpoint: "ftp://nope" });
    expect(warnings().some((m) => m.includes("not a valid http(s) URL"))).toBe(
      true
    );
    expect(
      (server as unknown as Record<symbol, unknown>)[INSTRUMENTED]
    ).toBeUndefined();
  });

  it("warns about a key that is not an analytics key but still uses it", () => {
    instrument(new McpServer({ name: "s", version: "1" }), {
      apiKey: "mcp_wrong",
      endpoint: "https://x.test",
    });
    expect(warnings().some((m) => m.includes("mfi_"))).toBe(true);
    expect(globalState().clients.size).toBe(1);
  });

  it("warns once about unsupported objects and never throws", () => {
    expect(instrument({ hello: "world" })).toEqual({ hello: "world" });
    expect(instrument(null)).toBeNull();
    expect(instrument(42)).toBe(42);
    expect(
      warnings().filter((m) => m.includes("nothing is recorded"))
    ).toHaveLength(1);
  });

  it("shares one queue per key across servers", () => {
    instrument(new McpServer({ name: "a", version: "1" }), {
      apiKey: "mfi_k",
      endpoint: "https://x.test",
    });
    instrument(new McpServer({ name: "b", version: "1" }), {
      apiKey: "mfi_k",
      endpoint: "https://x.test",
    });
    instrument(new McpServer({ name: "c", version: "1" }), {
      apiKey: "mfi_other",
      endpoint: "https://x.test",
    });
    expect(globalState().clients.size).toBe(2);
  });
});

describe("mcp-use v1 (nativeServer + getServerForSession)", () => {
  it("instruments every per-session server the factory returns", async () => {
    const ingest = await startIngest();
    class LegacyMcpUse {
      readonly config = { name: "legacy-mcp-use", version: "1.34.6" };
      readonly nativeServer = new McpServer(this.config);
      getServerForSession(_sessionId?: string): McpServer {
        return registerV1Fixture(new McpServer(this.config));
      }
    }
    const app = new LegacyMcpUse();
    instrument(app, { apiKey: "mfi_k", endpoint: ingest.url });

    const sessionServer = app.getServerForSession("s1");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await sessionServer.connect(serverSide);
    const client = new Client({ name: "legacy-client", version: "1.0.0" });
    await client.connect(clientSide);
    await client.listTools();
    await flush();
    await client.close();

    const events = ingest.events();
    expect(byMethod(events, "initialize")).toHaveLength(1);
    expect(byMethod(events, "tools/list")[0]?.client?.name).toBe(
      "legacy-client"
    );
    expect(ingest.batches[0]?.sdk.framework).toBe("mcp-use-v1");
    expect(ingest.batches[0]?.server).toEqual({
      name: "legacy-mcp-use",
      version: "1.34.6",
    });
    await shutdown();
    await ingest.close();
  });
});

describe("shutdown", () => {
  it("flushes and stops recording", async () => {
    const ingest = await startIngest();
    const server = new McpServer({ name: "s", version: "1" });
    instrument(server, { apiKey: "mfi_k", endpoint: ingest.url });
    registerV1Fixture(server);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "c", version: "1" });
    await client.connect(clientSide);
    await client.listTools();
    await shutdown();
    const delivered = ingest.events().length;
    expect(delivered).toBeGreaterThan(0);
    await client.listTools();
    await flush();
    expect(ingest.events()).toHaveLength(delivered);
    // Per-request servers instrumented after shutdown() stay untouched.
    const later = new McpServer({ name: "later", version: "1" });
    instrument(later, { apiKey: "mfi_k", endpoint: ingest.url });
    expect(
      (later as unknown as Record<symbol, unknown>)[INSTRUMENTED]
    ).toBeUndefined();
    await client.close();
    await ingest.close();
  });
});

describe("framework label", () => {
  async function labelOf(
    server: McpServer,
    options: Parameters<typeof instrument>[1]
  ): Promise<string | undefined> {
    const ingest = await startIngest();
    instrument(server, { apiKey: "mfi_k", endpoint: ingest.url, ...options });
    registerV1Fixture(server);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "c", version: "1" });
    await client.connect(clientSide);
    await client.listTools();
    await flush();
    await client.close();
    await ingest.close();
    return ingest.batches[0]?.sdk.framework;
  }

  it("uses the framework option when detection cannot tell (mcp-handler with its own name)", async () => {
    expect(
      await labelOf(new McpServer({ name: "weather", version: "1" }), {
        framework: "mcp-handler",
      })
    ).toBe("mcp-handler");
  });

  it("ignores an unknown framework label", async () => {
    expect(
      await labelOf(new McpServer({ name: "weather", version: "1" }), {
        framework: "nonsense" as never,
      })
    ).toBe("mcp-sdk-v1");
  });
});

describe("exit flush", () => {
  it("makes one bounded attempt when the event loop empties, never a retry loop", async () => {
    vi.useFakeTimers();
    try {
      const listeners: Array<() => void> = [];
      const on = process.on.bind(process);
      vi.spyOn(process, "on").mockImplementation(((
        event: string,
        listener: () => void
      ) => {
        if (event === "beforeExit") listeners.push(listener);
        else on(event, listener);
        return process;
      }) as typeof process.on);
      delete (globalThis as Record<symbol, unknown>)[
        Symbol.for("@mcp-use/analytics.exitHook")
      ];
      const posts: Array<{ at: number; abortedAt?: number }> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request, init?: RequestInit) => {
          if (String(input).endsWith("/v1/config")) {
            return Promise.resolve(
              Response.json({
                config: { capture_payloads: false, identify_actors: false },
              })
            );
          }
          // A stalled ingest: requests only end when they are aborted.
          return new Promise<Response>((_, reject) => {
            const post: { at: number; abortedAt?: number } = {
              at: Date.now(),
            };
            posts.push(post);
            init?.signal?.addEventListener("abort", () => {
              post.abortedAt = Date.now();
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        })
      );

      instrument(new McpServer({ name: "s", version: "1" }), {
        apiKey: "mfi_k",
        endpoint: "https://ingest.test",
      });
      expect(listeners).toHaveLength(1);
      const [client] = [...globalState().clients.values()];
      // The settings are known, as after any earlier exchange.
      await client!.flush();
      client!.enqueue({
        source: { framework: "mcp-sdk-v1" },
        toWire: async () => ({
          id: "evt-exit",
          time: new Date().toISOString(),
          method: "tools/list",
        }),
      });

      // The event loop emptied: beforeExit fires, again after each round of work.
      listeners[0]!();
      await vi.advanceTimersByTimeAsync(2_050);
      expect(posts).toHaveLength(1);
      expect(posts[0]!.abortedAt! - posts[0]!.at).toBeLessThanOrEqual(2_000);
      expect(client!.hasWork).toBe(false);
      listeners[0]!();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(posts).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
