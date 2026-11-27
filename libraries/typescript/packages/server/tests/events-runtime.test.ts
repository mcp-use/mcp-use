import { describe, expect, it } from "vitest";
import { EventsRuntime } from "../src/events/runtime.js";
import { memoryEventsStore, type EventsStore } from "../src/events/store.js";
import { postWebhook } from "../src/events/webhook.js";

const NAME = "note.created";
const defs = () => new Map([[NAME, { name: NAME }]]);

const ctx = () => ({
  request: new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: { "mcp-name": NAME },
  }),
  legacy: false,
  clientName: null,
});

const subscribeParams = {
  name: NAME,
  arguments: {},
  delivery: {
    mode: "webhook",
    url: "https://hooks.example.test/notes",
    secret: `whsec_${Buffer.alloc(32, 1).toString("base64")}`,
  },
};

const user = {
  token: "t",
  clientId: "c",
  scopes: [],
  extra: { user: { id: "alice" } },
};

/** A promise and the function that resolves it. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

/** Echoes verification challenges; records delivered event ids. */
function recordingFetch(delivered: string[]) {
  const f: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as {
      challenge?: string;
      eventId?: string;
    };
    if (body.challenge !== undefined)
      return new Response(JSON.stringify({ challenge: body.challenge }));
    delivered.push(body.eventId!);
    return new Response("ok");
  };
  return f;
}

async function poll(runtime: EventsRuntime, cursor?: string, args?: unknown) {
  const { outcome } = await runtime.handle(
    "events/poll",
    { name: NAME, arguments: args, ...(cursor && { cursor }) },
    undefined,
    ctx()
  );
  return outcome as {
    result?: { cursor: string; events: { eventId: string }[] };
    error?: { code: number };
  };
}

describe("webhook callback address check", () => {
  const ok: typeof fetch = async () => new Response("ok");

  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "[::1]",
    "[::]",
    "[::ffff:127.0.0.1]",
    "[::ffff:7f00:1]",
    "[::ffff:a9fe:a9fe]",
    "[0:0:0:0:0:ffff:a00:1]",
    "[::ffff:0:7f00:1]",
    "[::7f00:1]",
    "[64:ff9b::7f00:1]",
    "[64:ff9b:1::1]",
    "[2002:a9fe:a9fe::1]",
    "[2001::1]",
    "[fe80::1]",
    "[fd12:3456::1]",
    "[ff02::1]",
  ])("rejects %s", async (host) => {
    await expect(
      postWebhook(`https://${host}/hook`, {}, "{}", {
        allowInsecure: false,
        fetch: ok,
      })
    ).rejects.toThrow("non-public");
  });

  it.each([
    "8.8.8.8",
    "[2606:4700:4700::1111]",
    "[::ffff:808:808]",
    "[64:ff9b::808:808]",
  ])("accepts public %s", async (host) => {
    const res = await postWebhook(`https://${host}/hook`, {}, "{}", {
      allowInsecure: false,
      fetch: ok,
    });
    expect(res.status).toBe(200);
  });
});

describe("events delivery queue", () => {
  it("keeps a job queued when the store fails during its attempt", async () => {
    const store = memoryEventsStore();
    let failJobRead = true;
    const flaky: EventsStore = {
      ...store,
      get: async (key) => {
        if (key.startsWith("job:") && failJobRead) {
          failJobRead = false;
          throw new Error("store unavailable");
        }
        return store.get(key);
      },
    };
    const delivered: string[] = [];
    const runtime = new EventsRuntime(defs(), {
      store: flaky,
      fetch: recordingFetch(delivered),
    });
    await runtime.handle("events/subscribe", subscribeParams, user, ctx());

    await runtime.emit(NAME, {}, { eventId: "evt_a" });

    expect(delivered).toEqual([]);
    expect(await store.zrange("queue", 0, -1)).toHaveLength(1);
    runtime.close();
  });
});

describe("events/poll", () => {
  it("does not skip an event whose log entry is written after a later one", async () => {
    const store = memoryEventsStore();
    const hold = gate();
    let holdNext = false;
    const slow: EventsStore = {
      ...store,
      zadd: async (key, score, member) => {
        if (holdNext && key.startsWith("log:")) {
          holdNext = false;
          await hold.opened;
        }
        return store.zadd(key, score, member);
      },
    };
    const runtime = new EventsRuntime(defs(), { store: slow });
    const start = (await poll(runtime)).result!.cursor;

    holdNext = true;
    const inFlight = runtime.emit(NAME, {}, { eventId: "evt_a" });
    await runtime.emit(NAME, {}, { eventId: "evt_b" });
    const during = (await poll(runtime, start)).result!;
    hold.open();
    await inFlight;
    const after = (await poll(runtime, during.cursor)).result!;

    const seen = [...during.events, ...after.events].map((e) => e.eventId);
    expect(seen.sort()).toEqual(["evt_a", "evt_b"]);
    runtime.close();
  });

  it("recovers after a failed epoch read", async () => {
    const store = memoryEventsStore();
    let fail = true;
    const flaky: EventsStore = {
      ...store,
      get: async (key) => {
        if (key === "log:epoch" && fail) {
          fail = false;
          throw new Error("store unavailable");
        }
        return store.get(key);
      },
    };
    const runtime = new EventsRuntime(defs(), { store: flaky });

    expect((await poll(runtime)).error?.code).toBe(-32603);
    expect((await poll(runtime)).result?.cursor).toEqual(expect.any(String));
    runtime.close();
  });

  it("rejects non-object arguments for an event without inputSchema", async () => {
    const runtime = new EventsRuntime(defs());
    expect((await poll(runtime, undefined, 5)).error?.code).toBe(-32602);
    expect((await poll(runtime, undefined, [1])).error?.code).toBe(-32602);
    expect((await poll(runtime, undefined, {})).result).toBeDefined();
    runtime.close();
  });
});
