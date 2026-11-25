import { describe, expect, it } from "vitest";
import {
  createEventsConnection,
  createEventsManager,
  createSdkClientEventsAdapter,
  memoryEventsStore,
  type EventsClientError,
  type EventsStore,
} from "../../src/events/index.js";
import { ScriptedTransport, envelope, flush } from "./scripted-transport.js";

/** A scripted Events server with an in-memory log of three events. */
function server(opts: { delivery?: string[]; pushActive?: boolean } = {}) {
  const log = [envelope(1), envelope(2), envelope(3)];
  const polls: Array<string | null> = [];
  const raw = new ScriptedTransport((m, t) => {
    if (m.method === "initialize") {
      t.result(m.id, {
        protocolVersion: "2025-11-25",
        capabilities: { events: {} },
      });
    }
    if (m.method === "events/list") {
      t.result(m.id, {
        events: [
          {
            name: "note.created",
            delivery: opts.delivery ?? ["push", "poll"],
            inputSchema: { type: "object" },
          },
        ],
      });
    }
    if (m.method === "events/poll") {
      const cursor = m.params.cursor as string | null;
      polls.push(cursor);
      const from = cursor === null ? 0 : Number(cursor.slice(1));
      const events = log.slice(from);
      t.result(m.id, {
        events,
        cursor: events.length ? events[events.length - 1]!.cursor : cursor,
        truncated: false,
        hasMore: false,
        nextPollMs: 1000,
      });
    }
    if (m.method === "events/stream" && opts.pushActive !== false) {
      const cursor = m.params.cursor as string | null;
      const from = cursor === null ? 0 : Number(cursor.slice(1));
      t.frame("notifications/events/active", m.id, {
        cursor,
        truncated: false,
        heartbeatMs: 30000,
      });
      for (const e of log.slice(from))
        t.frame("notifications/events/event", m.id, e);
    }
  });
  const lane = createSdkClientEventsAdapter();
  const wrapped = lane.wrapTransport(raw);
  wrapped.onmessage = () => undefined;
  void wrapped.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  return { raw, polls, conn: createEventsConnection(lane) };
}

async function take(
  it: AsyncIterable<{ eventId: string }>,
  n: number
): Promise<string[]> {
  const out: string[] = [];
  for await (const e of it) {
    out.push(e.eventId);
    if (out.length === n) break;
  }
  return out;
}

describe("client.events manager", () => {
  it("chooses push without a receiver and delivers events in order", async () => {
    const s = server();
    await flush();
    const m = createEventsManager({ connection: async () => s.conn });
    const sub = await m.subscribe("notes", "note.created", {});
    expect(sub.mode).toBe("push");
    expect(await take(sub, 3)).toEqual(["e1", "e2", "e3"]);
    await m.close();
  });

  it("resumes a poll subscription from the persisted cursor after a client restart", async () => {
    const store: EventsStore = memoryEventsStore();
    const s1 = server({ delivery: ["poll"] });
    await flush();
    const m1 = createEventsManager({ connection: async () => s1.conn, store });
    const sub1 = await m1.subscribe("notes", "note.created", {});
    expect(await take(sub1, 3)).toEqual(["e1", "e2", "e3"]);
    await flush();
    await m1.close();

    const s2 = server({ delivery: ["poll"] });
    await flush();
    const m2 = createEventsManager({ connection: async () => s2.conn, store });
    const [sub2] = await m2.resume("notes");
    await flush(20);
    await m2.close();
    expect(sub2!.mode).toBe("poll");
    expect(s2.polls[0]).toBe("c3");
  });

  it("does not redeliver events whose ids are in the persisted recentEventIds", async () => {
    const store = memoryEventsStore();
    const s1 = server();
    await flush();
    const m1 = createEventsManager({ connection: async () => s1.conn, store });
    const sub1 = await m1.subscribe("notes", "note.created", {});
    expect(await take(sub1, 3)).toEqual(["e1", "e2", "e3"]);
    const rec = JSON.parse((await store.get(sub1.key))!);
    rec.cursor = null; // a lost cursor write: the server replays from the start
    await store.set(sub1.key, JSON.stringify(rec));
    // fresh manager, same store
    const s2 = server();
    await flush();
    const delivered: string[] = [];
    const m2 = createEventsManager({
      connection: async () => s2.conn,
      store,
      onEvent: (e) => void delivered.push(e.eventId),
    });
    await m2.subscribe("notes", "note.created", {});
    await flush(20);
    await m2.close();
    expect(delivered).toEqual([]);
  });

  it("falls back from push to poll when active never arrives", async () => {
    const s = server({ pushActive: false });
    await flush();
    const m = createEventsManager({
      connection: async () => s.conn,
      activeTimeoutMs: 20,
    });
    const sub = await m.subscribe("notes", "note.created", {});
    expect(await take(sub, 3)).toEqual(["e1", "e2", "e3"]);
    expect(sub.mode).toBe("poll");
    await m.close();
  });

  it("throws receiver_required for a webhook-only event without a receiver", async () => {
    const s = server({ delivery: ["webhook"] });
    await flush();
    const m = createEventsManager({ connection: async () => s.conn });
    await expect(
      m.subscribe("notes", "note.created", {})
    ).rejects.toMatchObject({
      code: "receiver_required",
    } satisfies Partial<EventsClientError>);
  });
});
