import {
  AnalyticsClient,
  EXIT_FLUSH_MS,
  type ClientSettings,
  type PendingEvent,
} from "../src/client.js";
import type {
  AnalyticsBatch,
  AnalyticsEvent,
  RemoteConfig,
} from "../src/types.js";

interface Call {
  url: string;
  method: string;
  body: AnalyticsBatch | undefined;
}

type Reply = Response | Error;

/** A fetch stub answering `/v1/config` with `config` and `/v1/events` from `replies` (then 202). */
function stubFetch(
  replies: Reply[] = [],
  config: RemoteConfig = { capture_payloads: false, identify_actors: false }
) {
  const calls: Call[] = [];
  const fetchStub = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as AnalyticsBatch)
          : undefined;
      calls.push({ url, method, body });
      if (url.endsWith("/v1/config")) return Response.json({ config });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return (
        reply ??
        Response.json(
          { accepted: body?.events.length ?? 0, rejected: [], config },
          { status: 202 }
        )
      );
    }
  );
  vi.stubGlobal("fetch", fetchStub);
  const posts = () => calls.filter((c) => c.method === "POST");
  return {
    calls,
    posts,
    events: () => posts().flatMap((c) => c.body?.events ?? []),
  };
}

function settings(overrides: Partial<ClientSettings> = {}): ClientSettings {
  return {
    apiKey: "mfi_unit",
    endpoint: "https://ingest.test",
    debug: false,
    flushIntervalMs: 1000,
    maxBatchSize: 100,
    maxQueueSize: 1000,
    ...overrides,
  };
}

let next = 0;
function pending(
  extra: Partial<AnalyticsEvent> = {}
): PendingEvent & { seen: RemoteConfig[] } {
  const seen: RemoteConfig[] = [];
  const id = `evt-${++next}`;
  return {
    source: { framework: "mcp-sdk-v1", server: { name: "unit", version: "1" } },
    seen,
    toWire: async (config) => {
      seen.push(config);
      return {
        id,
        time: new Date(0).toISOString(),
        method: "tools/list",
        ...extra,
      };
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("batching", () => {
  it("flushes after the interval with the wire envelope and bearer key", async () => {
    vi.useFakeTimers();
    const net = stubFetch();
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(999);
    expect(net.posts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(net.posts()).toHaveLength(1);
    const post = net.posts()[0]!;
    expect(post.url).toBe("https://ingest.test/v1/events");
    expect(post.body).toMatchObject({
      schema: "manufact.sdk.v1",
      sdk: {
        name: "@mcp-use/analytics",
        language: "typescript",
        framework: "mcp-sdk-v1",
      },
      server: { name: "unit", version: "1" },
    });
    expect(post.body?.events).toHaveLength(2);
    const init = (
      fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls.find(([url]) => String(url).endsWith("/v1/events"))?.[1];
    expect((init?.headers as Record<string, string>)["authorization"]).toBe(
      "Bearer mfi_unit"
    );
  });

  it("flushes as soon as a batch is full and splits by maxBatchSize", async () => {
    vi.useFakeTimers();
    const net = stubFetch();
    const client = new AnalyticsClient(settings({ maxBatchSize: 3 }));
    for (let i = 0; i < 7; i++) client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(1);
    await client.flush();
    expect(net.events()).toHaveLength(7);
    expect(net.posts().every((p) => (p.body?.events.length ?? 0) <= 3)).toBe(
      true
    );
  });

  it("keeps a batch under the 1 MB body limit", async () => {
    const net = stubFetch();
    const client = new AnalyticsClient(settings());
    const big = "x".repeat(200_000);
    for (let i = 0; i < 9; i++) client.enqueue(pending({ target: big }));
    await client.flush();
    expect(net.events()).toHaveLength(9);
    expect(net.posts().length).toBeGreaterThanOrEqual(2);
    for (const post of net.posts()) {
      expect(JSON.stringify(post.body).length).toBeLessThan(1_000_000);
    }
  });

  it("drops the oldest events beyond maxQueueSize", async () => {
    const net = stubFetch();
    const client = new AnalyticsClient(settings({ maxQueueSize: 2 }));
    client.enqueue(pending({ target: "a" }));
    client.enqueue(pending({ target: "b" }));
    client.enqueue(pending({ target: "c" }));
    await client.flush();
    expect(net.events().map((e) => e.target)).toEqual(["b", "c"]);
  });

  it("hands each event's flush to waitUntil", async () => {
    const net = stubFetch();
    const client = new AnalyticsClient(settings());
    const waited: Promise<unknown>[] = [];
    client.enqueue(pending(), (promise) => waited.push(promise));
    expect(waited).toHaveLength(1);
    await waited[0];
    expect(net.events()).toHaveLength(1);
  });
});

describe("delivery", () => {
  it("retries 5xx and network errors with the same event ids", async () => {
    vi.useFakeTimers();
    const net = stubFetch([
      new Response(null, { status: 503 }),
      new TypeError("fetch failed"),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(net.posts()).toHaveLength(3);
    const ids = net.posts().map((p) => p.body?.events[0]?.id);
    expect(new Set(ids).size).toBe(1);
  });

  it("waits for Retry-After on 429", async () => {
    vi.useFakeTimers();
    const net = stubFetch([
      new Response(null, { status: 429, headers: { "retry-after": "30" } }),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(net.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(net.posts()).toHaveLength(2);
  });

  it("gives up on a batch after the attempt limit", async () => {
    const net = stubFetch(
      Array.from({ length: 20 }, () => new Response(null, { status: 500 }))
    );
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    for (let i = 0; i < 10; i++) await client.flush();
    expect(net.posts()).toHaveLength(8);
  });

  it("stops for good on 401 and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const net = stubFetch([new Response(null, { status: 401 })]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await client.flush();
    expect(client.state).toBe("unauthorized");
    expect(client.active).toBe(false);
    client.enqueue(pending());
    await client.flush();
    expect(net.posts()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("401");
  });

  it("stops when GET /v1/config answers 401", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 }))
    );
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await client.flush();
    expect(client.state).toBe("unauthorized");
  });

  it("pauses and drops events on 402", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const net = stubFetch([new Response(null, { status: 402 })]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await client.flush();
    expect(client.active).toBe(false);
    client.enqueue(pending());
    await client.flush();
    expect(net.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(client.active).toBe(true);
    client.enqueue(pending());
    await client.flush();
    expect(net.posts()).toHaveLength(2);
  });

  it("drops a batch the endpoint rejects with 400", async () => {
    const net = stubFetch([
      new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await client.flush();
    await client.flush();
    expect(net.posts()).toHaveLength(1);
    expect(client.active).toBe(true);
  });

  it("splits a batch the endpoint rejects with 413", async () => {
    const net = stubFetch([new Response(null, { status: 413 })]);
    const client = new AnalyticsClient(settings());
    for (let i = 0; i < 4; i++) client.enqueue(pending());
    await client.flush();
    const sizes = net.posts().map((p) => p.body?.events.length);
    expect(sizes).toEqual([4, 2, 2]);
  });
});

describe("capture settings", () => {
  it("fetches GET /v1/config before serializing the first batch", async () => {
    const net = stubFetch([], {
      capture_payloads: true,
      identify_actors: true,
    });
    const client = new AnalyticsClient(settings());
    const event = pending();
    client.enqueue(event);
    await client.flush();
    expect(net.calls[0]?.url).toBe("https://ingest.test/v1/config");
    expect(event.seen).toEqual([
      { capture_payloads: true, identify_actors: true },
    ]);
    expect(client.remoteConfig).toEqual({
      capture_payloads: true,
      identify_actors: true,
    });
  });

  it("serializes with nothing optional while the settings are unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("/v1/config")
          ? new Response(null, { status: 503 })
          : Response.json({ accepted: 1, rejected: [] }, { status: 202 })
      )
    );
    const client = new AnalyticsClient(settings());
    const event = pending();
    client.enqueue(event);
    await client.flush();
    expect(event.seen).toEqual([
      { capture_payloads: false, identify_actors: false },
    ]);
    expect(client.mayCapturePayloads).toBe(true);
  });

  it("follows the config returned with each batch", async () => {
    const net = stubFetch([
      Response.json(
        {
          accepted: 1,
          rejected: [],
          config: { capture_payloads: true, identify_actors: false },
        },
        { status: 202 }
      ),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await client.flush();
    expect(client.remoteConfig).toEqual({
      capture_payloads: true,
      identify_actors: false,
    });
    expect(net.posts()).toHaveLength(1);
  });
});

describe("settings refresh", () => {
  const OFF: RemoteConfig = { capture_payloads: false, identify_actors: false };
  const ON: RemoteConfig = { capture_payloads: true, identify_actors: true };

  interface Exchange {
    method: string;
    path: string;
    at: number;
    abortedAt?: number;
  }

  /**
   * A fetch stub: `GET /v1/config` answers from `gets` in order ("stall"
   * answers only by being aborted), then `{ config }`; `POST /v1/events`
   * answers from `posts`, then 202, with `config` unless `postConfig` is
   * false. `config` is read at each answer, so a test can change it.
   */
  function settingsFetch(options: {
    config: RemoteConfig;
    gets?: Array<Response | "stall">;
    posts?: Response[];
    postConfig?: boolean;
  }) {
    const log: Exchange[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const exchange: Exchange = {
          method: init?.method ?? "GET",
          path: new URL(String(input)).pathname,
          at: Date.now(),
        };
        log.push(exchange);
        const reply =
          exchange.path === "/v1/config"
            ? (options.gets?.shift() ??
              Response.json({ config: { ...options.config } }))
            : (options.posts?.shift() ??
              Response.json(
                {
                  accepted: 1,
                  rejected: [],
                  ...(options.postConfig !== false && {
                    config: { ...options.config },
                  }),
                },
                { status: 202 }
              ));
        if (reply !== "stall") return Promise.resolve(reply);
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            exchange.abortedAt = Date.now();
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      })
    );
    return {
      log,
      gets: () => log.filter((e) => e.path === "/v1/config"),
      posts: () => log.filter((e) => e.path === "/v1/events"),
    };
  }

  /** Replace the clock that ages the client's settings with one that moves only when told to. */
  function fakeClock(client: AnalyticsClient) {
    let now = 1_000;
    client.clock = () => now;
    return {
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("fetches settings older than a minute once, before serializing the next batch", async () => {
    const config = { ...OFF };
    const net = settingsFetch({ config });
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    const clock = fakeClock(client);
    const first = pending();
    client.enqueue(first);
    await client.flush();
    expect(first.seen).toEqual([OFF]);
    // Turned on in the dashboard; the next events come more than a minute
    // after the last reply.
    Object.assign(config, ON);
    clock.advance(61_000);
    const later = [pending(), pending(), pending(), pending()];
    for (const event of later) client.enqueue(event);
    await client.flush();
    for (const event of later) expect(event.seen).toEqual([ON]);
    expect(net.log.map((e) => `${e.method} ${e.path}`)).toEqual([
      "GET /v1/config",
      "POST /v1/events",
      "GET /v1/config",
      "POST /v1/events",
    ]);
  });

  it("does not fetch settings a reply brought less than a minute ago", async () => {
    const config = { ...OFF };
    const net = settingsFetch({ config });
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    const clock = fakeClock(client);
    client.enqueue(pending());
    await client.flush();
    Object.assign(config, ON);
    clock.advance(59_000);
    const second = pending();
    client.enqueue(second);
    await client.flush();
    // Still within the minute: the settings of the last reply.
    expect(second.seen).toEqual([OFF]);
    // That reply carried the new settings and restarted the minute.
    clock.advance(59_000);
    const third = pending();
    client.enqueue(third);
    await client.flush();
    expect(third.seen).toEqual([ON]);
    expect(net.gets()).toHaveLength(1);
  });

  it("keeps the last settings when a refresh fails, without delaying the batch, and waits a minute to try again", async () => {
    vi.useFakeTimers();
    const last: RemoteConfig = {
      capture_payloads: true,
      identify_actors: false,
    };
    const net = settingsFetch({
      config: last,
      // The first answer, then a refresh that times out, then one answered 503.
      gets: [
        Response.json({ config: last }),
        "stall",
        new Response(null, { status: 503 }),
      ],
      // Only GET /v1/config brings settings here.
      postConfig: false,
    });
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    const clock = fakeClock(client);
    const events = [pending(), pending(), pending(), pending()];
    client.enqueue(events[0]!);
    await client.flush();

    clock.advance(61_000);
    client.enqueue(events[1]!);
    const flushed = client.flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await flushed;
    // The refresh gave up after 2 s and the batch went out right then.
    const refresh = net.gets()[1]!;
    expect(refresh.abortedAt! - refresh.at).toBe(2_000);
    expect(net.posts()[1]!.at).toBe(refresh.abortedAt);

    // A failure counts as a refresh: no new attempt within the minute.
    clock.advance(59_000);
    client.enqueue(events[2]!);
    await client.flush();
    expect(net.gets()).toHaveLength(2);

    // A minute later it is tried again; an error answer holds nothing back
    // (this flush settles without any timer firing).
    clock.advance(2_000);
    client.enqueue(events[3]!);
    await client.flush();
    expect(net.gets()).toHaveLength(3);
    expect(net.posts()).toHaveLength(4);
    expect(events.map((e) => e.seen)).toEqual([[last], [last], [last], [last]]);
  });

  it("makes no refresh while a 429 holds sends back", async () => {
    vi.useFakeTimers();
    const net = settingsFetch({
      config: OFF,
      posts: [
        new Response(null, { status: 429, headers: { "retry-after": "30" } }),
      ],
    });
    const client = new AnalyticsClient(settings());
    const clock = fakeClock(client);
    client.enqueue(pending({ target: "first" }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(net.posts()).toHaveLength(1);
    // Sends pause for 30 s; the settings get stale meanwhile.
    clock.advance(61_000);
    client.enqueue(pending({ target: "held" }));
    await client.flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(net.gets()).toHaveLength(1);
    expect(net.posts()).toHaveLength(1);
    // Once the pause ends, the settings are fetched before the held event is
    // serialized, and both events go out.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(net.log.slice(2).map((e) => `${e.method} ${e.path}`)).toEqual([
      "GET /v1/config",
      "POST /v1/events",
      "POST /v1/events",
    ]);
  });

  it("holds sends back when a refresh is answered 429", async () => {
    vi.useFakeTimers();
    const net = settingsFetch({
      config: OFF,
      gets: [
        Response.json({ config: OFF }),
        new Response(null, { status: 429, headers: { "retry-after": "5" } }),
      ],
    });
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    const clock = fakeClock(client);
    client.enqueue(pending());
    await client.flush();
    clock.advance(61_000);
    const later = pending();
    client.enqueue(later);
    await client.flush();
    // Serialized with the last settings, sent once the key's pause ends.
    expect(later.seen).toEqual([OFF]);
    expect(net.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(net.posts()).toHaveLength(2);
    expect(net.gets()).toHaveLength(2);
  });

  it("never refreshes the settings during an exit or signal flush", async () => {
    const config = { ...OFF };
    const net = settingsFetch({ config, postConfig: false });
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    const clock = fakeClock(client);
    client.enqueue(pending());
    await client.flush();
    Object.assign(config, ON);
    clock.advance(61_000);
    const onSignal = pending();
    client.enqueue(onSignal);
    await client.flushOnSignal();
    const onExit = pending();
    client.enqueue(onExit);
    await client.flushOnExit();
    expect(net.gets()).toHaveLength(1);
    expect(net.posts()).toHaveLength(3);
    expect([onSignal.seen, onExit.seen]).toEqual([[OFF], [OFF]]);
  });
});

/** A fetch stub whose `POST /v1/events` answers 202 after `delayMs`. */
function slowFetch(delayMs: number) {
  const posts: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/config")) {
        return Response.json({
          config: { capture_payloads: false, identify_actors: false },
        });
      }
      posts.push(Date.now());
      const body = JSON.parse(String(init?.body)) as AnalyticsBatch;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return Response.json(
        { accepted: body.events.length, rejected: [] },
        { status: 202 }
      );
    })
  );
  return posts;
}

/** A fetch stub for an endpoint that never answers (requests end only when aborted). */
function stalledFetch() {
  const calls: Array<{ path: string; at: number; abortedAt?: number }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const call: { path: string; at: number; abortedAt?: number } = {
            path: new URL(String(input)).pathname,
            at: Date.now(),
          };
          calls.push(call);
          init?.signal?.addEventListener("abort", () => {
            call.abortedAt = Date.now();
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    )
  );
  return calls;
}

describe("flush promises under steady traffic", () => {
  it("settles a waitUntil promise after the pass that covers its event, while traffic continues", async () => {
    vi.useFakeTimers();
    const posts = slowFetch(200);
    const client = new AnalyticsClient(settings());
    const waited: Promise<unknown>[] = [];
    const waitUntil = (promise: Promise<unknown>) => {
      waited.push(promise);
    };
    const start = Date.now();
    let settledAfter: number | undefined;
    client.enqueue(pending(), waitUntil);
    void waited[0]!.then(() => {
      settledAfter = Date.now() - start;
    });
    // One request every 50 ms for 4 s, each POST taking 200 ms: the drain
    // loop never runs dry.
    for (let i = 0; i < 80; i++) {
      await vi.advanceTimersByTimeAsync(50);
      client.enqueue(pending(), waitUntil);
    }
    expect(settledAfter).toBeDefined();
    expect(settledAfter!).toBeLessThan(1_000);
    expect(posts.length).toBeGreaterThan(5);
  });

  it("resolves flush() once the events queued before it were attempted, not when traffic stops", async () => {
    vi.useFakeTimers();
    slowFetch(300);
    const client = new AnalyticsClient(settings({ flushIntervalMs: 100 }));
    client.enqueue(pending());
    const start = Date.now();
    let resolvedAfter: number | undefined;
    void client.flush().then(() => {
      resolvedAfter = Date.now() - start;
    });
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(100);
      client.enqueue(pending());
    }
    expect(resolvedAfter).toBeDefined();
    expect(resolvedAfter!).toBeLessThan(1_000);
  });

  it("does not let an event that never serializes hold flush() or later deliveries", async () => {
    vi.useFakeTimers();
    const net = stubFetch();
    const client = new AnalyticsClient(settings());
    client.enqueue({
      source: { framework: "mcp-sdk-v1" },
      toWire: () => new Promise(() => undefined),
    });
    client.enqueue(pending({ target: "ok" }));
    let flushed = false;
    void client.flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(5_100);
    expect(flushed).toBe(true);
    expect(net.events().map((e) => e.target)).toEqual(["ok"]);
    client.enqueue(pending({ target: "later" }));
    await client.flush();
    expect(net.events().map((e) => e.target)).toEqual(["ok", "later"]);
  });

  it("waits briefly in flush() for work that is about to queue events", async () => {
    vi.useFakeTimers();
    const net = stubFetch();
    const client = new AnalyticsClient(settings());
    client.track(
      new Promise<void>((resolve) => {
        setTimeout(() => {
          client.enqueue(pending({ target: "read-late" }));
          resolve();
        }, 20);
      })
    );
    client.track(new Promise(() => undefined));
    let flushed = false;
    void client.flush().then(() => {
      flushed = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(flushed).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(flushed).toBe(true);
    expect(net.events().map((e) => e.target)).toEqual(["read-late"]);
  });
});

describe("rate limiting", () => {
  it("pauses every send for Retry-After after a 429, then sends the held events together", async () => {
    vi.useFakeTimers();
    const net = stubFetch([
      new Response(null, { status: 429, headers: { "retry-after": "30" } }),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending({ target: "first" }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(net.posts()).toHaveLength(1);
    // The 429 arrived at t=1s; keep queueing for the next 20 s.
    for (let i = 0; i < 10; i++) {
      client.enqueue(pending({ target: `held-${i}` }));
      await vi.advanceTimersByTimeAsync(2_000);
    }
    // Not even a forced flush may send during the pause.
    await client.flush();
    expect(net.posts()).toHaveLength(1);
    expect(client.hasWork).toBe(true);
    await vi.advanceTimersByTimeAsync(11_000);
    const after = net.posts().slice(1);
    expect(after.map((p) => p.body?.events.map((e) => e.target))).toEqual([
      ["first"],
      Array.from({ length: 10 }, (_, i) => `held-${i}`),
    ]);
  });

  it("does not count a Retry-After pause as a failed attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    // Seven failures leave the batch one attempt from being dropped; the 429
    // that follows must not use it up.
    const net = stubFetch([
      ...Array.from({ length: 7 }, () => new Response(null, { status: 503 })),
      new Response(null, { status: 429, headers: { "retry-after": "5" } }),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    // 1 s flush interval + 31.75 s of backoff + the 5 s pause.
    await vi.advanceTimersByTimeAsync(37_000);
    expect(net.posts()).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(net.posts()).toHaveLength(9);
    expect(new Set(net.events().map((e) => e.id)).size).toBe(1);
    expect(client.hasWork).toBe(false);
  });

  it("keeps a batch through more 429s than the attempt limit", async () => {
    vi.useFakeTimers();
    const net = stubFetch(
      Array.from(
        { length: 12 },
        () =>
          new Response(null, { status: 429, headers: { "retry-after": "1" } })
      )
    );
    const client = new AnalyticsClient(settings());
    client.enqueue(pending({ target: "kept" }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.posts()).toHaveLength(13);
    expect(client.hasWork).toBe(false);
  });

  it("pauses at least a second for Retry-After: 0", async () => {
    vi.useFakeTimers();
    const net = stubFetch([
      new Response(null, { status: 429, headers: { "retry-after": "0" } }),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(900);
    expect(net.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(net.posts()).toHaveLength(2);
    expect(client.hasWork).toBe(false);
  });

  it("counts a 429 without Retry-After as a failed attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const net = stubFetch(
      Array.from(
        { length: 20 },
        (_, i) =>
          new Response(null, {
            status: 429,
            // An empty header is no Retry-After either.
            headers: i % 2 === 0 ? {} : { "retry-after": "" },
          })
      )
    );
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(net.posts()).toHaveLength(8);
    expect(client.hasWork).toBe(false);
  });

  it.each([429, 503])(
    "caps a %i's Retry-After at ten minutes",
    async (status) => {
      vi.useFakeTimers();
      const net = stubFetch([
        new Response(null, { status, headers: { "retry-after": "86400" } }),
      ]);
      const client = new AnalyticsClient(settings());
      client.enqueue(pending());
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(10 * 60_000 - 1_000);
      expect(net.posts()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(net.posts()).toHaveLength(2);
      expect(client.hasWork).toBe(false);
    }
  );

  it("drops a batch rate limited during the exit flush instead of holding the process", async () => {
    vi.useFakeTimers();
    const net = stubFetch([
      new Response(null, { status: 429, headers: { "retry-after": "30" } }),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await client.flushOnExit();
    expect(net.posts()).toHaveLength(1);
    expect(client.hasWork).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.posts()).toHaveLength(1);
  });
});

describe("partial acceptance", () => {
  it("retries only the events the edge marks retryable and never resends accepted ones", async () => {
    vi.useFakeTimers();
    const net = stubFetch([
      Response.json(
        {
          accepted: 1,
          rejected: [
            { index: 1, reason: "queue_unavailable", retryable: true },
            { index: 2, reason: "time: outside the window", retryable: false },
          ],
        },
        { status: 202 }
      ),
    ]);
    const client = new AnalyticsClient(settings());
    for (const target of ["a", "b", "c"]) client.enqueue(pending({ target }));
    await client.flush();
    expect(net.posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(net.posts()).toHaveLength(2);
    expect(net.posts()[1]!.body?.events.map((e) => e.target)).toEqual(["b"]);
    expect(net.posts()[1]!.body?.events[0]?.id).toBe(
      net.posts()[0]!.body?.events[1]?.id
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(net.posts()).toHaveLength(2);
    expect(client.hasWork).toBe(false);
  });

  it("drops events rejected without retryable, and ignores malformed entries", async () => {
    const net = stubFetch([
      Response.json(
        {
          accepted: 0,
          rejected: [
            { index: 0, reason: "client.name: Too big" },
            { index: 7, reason: "queue_unavailable", retryable: true },
            { index: "1", retryable: true },
          ],
        },
        { status: 202 }
      ),
    ]);
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    client.enqueue(pending());
    await client.flush();
    await client.flush();
    expect(net.posts()).toHaveLength(1);
    expect(client.hasWork).toBe(false);
  });
});

describe("exit flush", () => {
  it("makes one attempt within the exit budget against a stalled endpoint, then gives up", async () => {
    vi.useFakeTimers();
    // Settings already known, as after any earlier exchange.
    stubFetch();
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await client.flush();
    const calls = stalledFetch();
    client.enqueue(pending());
    client.enqueue(pending());
    let done = false;
    void client.flushOnExit().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(EXIT_FLUSH_MS + 50);
    expect(done).toBe(true);
    expect(client.hasWork).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.abortedAt! - calls[0]!.at).toBeLessThanOrEqual(
      EXIT_FLUSH_MS
    );
    // The next beforeExit finds nothing to do: no retries keep the process alive.
    await client.flushOnExit();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(1);
  });

  it("bounds the background settings fetch, then sends on exit without waiting for it", async () => {
    vi.useFakeTimers();
    const calls = stalledFetch();
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    // The background settings fetch queued with the event gives up quickly.
    client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls.map((c) => [c.path, c.abortedAt! - c.at])).toEqual([
      ["/v1/config", 3_000],
    ]);
    let done = false;
    void client.flushOnExit().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(EXIT_FLUSH_MS + 50);
    expect(done).toBe(true);
    expect(client.hasWork).toBe(false);
    expect(calls.map((c) => c.path)).toEqual(["/v1/config", "/v1/events"]);
    expect(calls[1]!.abortedAt! - calls[1]!.at).toBeLessThanOrEqual(
      EXIT_FLUSH_MS
    );
  });
});

describe("signal flush", () => {
  /** /v1/config never answers; /v1/events answers from `replies`, then 202. */
  function configStalls(replies: number[] = []) {
    const posts: Array<{ at: number; body: AnalyticsBatch }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/v1/config")) {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            );
          });
        }
        posts.push({
          at: Date.now(),
          body: JSON.parse(String(init?.body)) as AnalyticsBatch,
        });
        const status = replies.shift() ?? 202;
        return Promise.resolve(
          Response.json({ accepted: 1, rejected: [] }, { status })
        );
      })
    );
    return posts;
  }

  it("sends at once without waiting for the capture settings, sending nothing optional", async () => {
    const posts = configStalls();
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    const event = pending();
    client.enqueue(event);
    const started = Date.now();
    await client.flushOnSignal();
    expect(Date.now() - started).toBeLessThan(500);
    expect(posts).toHaveLength(1);
    expect(event.seen).toEqual([
      { capture_payloads: false, identify_actors: false },
    ]);
  });

  it("joins a flush that is waiting for the capture settings", async () => {
    const posts = configStalls();
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    client.enqueue(pending());
    const started = Date.now();
    // An ordinary flush waits up to 3 s for GET /v1/config...
    void client.flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toHaveLength(0);
    client.enqueue(pending());
    // ...until the signal: both events go out now.
    await client.flushOnSignal();
    expect(Date.now() - started).toBeLessThan(500);
    expect(posts.flatMap((p) => p.body.events)).toHaveLength(2);
  });

  it("keeps failed batches for a retry, as the process may keep running", async () => {
    const posts = configStalls([503]);
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    client.enqueue(pending());
    await client.flushOnSignal();
    expect(posts).toHaveLength(1);
    expect(client.hasWork).toBe(true);
    await client.flush();
    expect(posts).toHaveLength(2);
    expect(client.hasWork).toBe(false);
  });

  it("does not wait for the capture settings on exit either", async () => {
    const posts = configStalls();
    const client = new AnalyticsClient(settings({ flushIntervalMs: 60_000 }));
    client.enqueue(pending());
    const started = Date.now();
    await client.flushOnExit();
    expect(Date.now() - started).toBeLessThan(500);
    expect(posts).toHaveLength(1);
  });
});

describe("retry budget", () => {
  it("drops a batch that keeps failing after 8 attempts, about 30 to 60 seconds of backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const net = stubFetch(
      Array.from({ length: 20 }, () => new Response(null, { status: 503 }))
    );
    const client = new AnalyticsClient(settings());
    client.enqueue(pending());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(net.posts()).toHaveLength(1);
    // Shortest backoffs: 0.25 + 0.5 + 1 + 2 + 4 + 8 + 16 = 31.75 s.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(net.posts()).toHaveLength(7);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(net.posts()).toHaveLength(8);
    expect(client.hasWork).toBe(false);
  });
});
