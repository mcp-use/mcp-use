import { describe, expect, it } from "vitest";
import {
  createEventsConnection,
  createSdkClientEventsAdapter,
} from "../../src/events/index.js";
import {
  ScriptedTransport,
  NOTE_EVENT,
  envelope,
  flush,
} from "./scripted-transport.js";

function setup(reply: ConstructorParameters<typeof ScriptedTransport>[0]) {
  const raw = new ScriptedTransport(reply);
  const lane = createSdkClientEventsAdapter();
  const wrapped = lane.wrapTransport(raw);
  const forwarded: Record<string, unknown>[] = [];
  wrapped.onmessage = (m) => {
    forwarded.push(m as Record<string, unknown>);
  };
  return { raw, lane, wrapped, forwarded, conn: createEventsConnection(lane) };
}

describe("events lane and connection", () => {
  it("keeps raw capabilities the SDK schema would strip and passes the handshake through", async () => {
    const { wrapped, conn, forwarded } = setup((m, t) => {
      if (m.method === "initialize") {
        t.result(m.id, {
          protocolVersion: "2025-11-25",
          capabilities: { events: { listChanged: true } },
          serverInfo: { name: "s", version: "1" },
        });
      }
    });
    expect(conn.supportsEvents()).toBe(undefined);
    await wrapped.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    await flush();
    expect(conn.supportsEvents()).toBe(true);
    expect(conn.eventsInfo).toEqual({
      supported: true,
      via: "top-level",
      dialectHint: "openai",
      listChanged: true,
    });
    expect(forwarded).toHaveLength(1);
  });

  it("sends events/list with a lane id, legacy plain params, and keeps the response off Protocol", async () => {
    const { raw, conn, forwarded } = setup((m, t) => {
      if (m.method === "events/list")
        t.result(m.id, { events: [NOTE_EVENT, { bogus: true }] });
    });
    const { events } = await conn.listAllEvents();
    expect(events.map((e) => e.name)).toEqual(["note.created"]);
    expect(raw.sent).toEqual([
      { jsonrpc: "2.0", id: "mcp-use:ev:1", method: "events/list", params: {} },
    ]);
    expect(forwarded).toEqual([]);
  });

  it("builds the modern envelope from the SDK's own traffic and declares the extension", async () => {
    const { raw, wrapped, conn } = setup((m, t) => {
      if (m.method === "events/poll")
        t.result(m.id, {
          events: [],
          cursor: "c0",
          truncated: false,
          hasMore: false,
          nextPollMs: 5062.5,
        });
    });
    await wrapped.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "c", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    const r = await conn.pollEvents({ name: "note.created", cursor: null });
    expect(r).toEqual({
      events: [],
      cursor: "c0",
      truncated: false,
      hasMore: false,
      nextPollMs: 5062.5,
    });
    expect(raw.sent[1]).toEqual({
      jsonrpc: "2.0",
      id: "mcp-use:ev:1",
      method: "events/poll",
      params: {
        name: "note.created",
        cursor: null,
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "c", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/events": {} },
          },
        },
      },
    });
  });

  it("treats NotFound on unsubscribe as success and rejects other errors with the decoded kind", async () => {
    const { conn } = setup((m, t) => {
      if (m.method === "events/unsubscribe")
        t.error(m.id, -32023, "not found", { kind: "subscription" });
      if (m.method === "events/poll") t.error(m.id, -32024, "forbidden");
    });
    await expect(
      conn.unsubscribeEvent({
        name: "x",
        delivery: { mode: "webhook", url: "https://r" },
      })
    ).resolves.toBe(undefined);
    await expect(conn.pollEvents({ name: "x" })).rejects.toMatchObject({
      name: "EventsLaneError",
      code: -32024,
      kind: "forbidden",
    });
  });

  it("re-lists once and retries once on -32020", async () => {
    let polls = 0;
    const { raw, conn } = setup((m, t) => {
      if (m.method === "events/list") t.result(m.id, { events: [NOTE_EVENT] });
      if (m.method === "events/poll") {
        polls++;
        if (polls === 1) t.error(m.id, -32020, "header mismatch");
        else
          t.result(m.id, {
            events: [],
            cursor: null,
            truncated: false,
            hasMore: false,
          });
      }
    });
    await conn.pollEvents({ name: "note.created" });
    expect(raw.sent.map((m) => m.method)).toEqual([
      "events/poll",
      "events/list",
      "events/poll",
    ]);
  });

  it("streams: routes frames by lane id, tracks the cursor, and ends closed on the result frame", async () => {
    const { conn } = setup((m, t) => {
      if (m.method !== "events/stream") return;
      t.frame("notifications/events/active", m.id, {
        cursor: "c0",
        truncated: false,
        heartbeatMs: 30000,
      });
      t.frame("notifications/events/event", m.id, envelope(1));
      t.frame("notifications/events/event", "mcp-use:ev:999", envelope(2));
      t.frame("notifications/events/heartbeat", m.id, { cursor: "c5" });
      t.result(m.id, { _meta: {} });
    });
    const seen: string[] = [];
    const out = await conn.streamEvents(
      { name: "note.created", cursor: null },
      {
        onActive: () => seen.push("active"),
        onEvent: (e) => seen.push(e.eventId),
        onHeartbeat: (h) => seen.push(`hb:${h.cursor}`),
      }
    );
    expect(seen).toEqual(["active", "e1", "hb:c5"]);
    expect(out).toEqual({ end: "closed", cursor: "c5" });
  });

  it("ends no_active when active never arrives and sends one notifications/cancelled", async () => {
    const { raw, conn } = setup(() => undefined);
    const out = await conn.streamEvents(
      { name: "note.created" },
      { onActive: () => undefined, onEvent: () => undefined },
      { activeTimeoutMs: 20 }
    );
    expect(out).toEqual({ end: "no_active", cursor: null });
    await flush();
    expect(
      raw.sent.filter((m) => m.method === "notifications/cancelled")
    ).toEqual([
      {
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: {
          requestId: "mcp-use:ev:1",
          reason: "client closed the stream",
        },
      },
    ]);
  });

  it("reports a terminated stream with its error", async () => {
    const { conn } = setup((m, t) => {
      if (m.method !== "events/stream") return;
      t.frame("notifications/events/active", m.id, {
        cursor: null,
        truncated: false,
        heartbeatMs: 30000,
      });
      t.frame("notifications/events/terminated", m.id, {
        error: { code: -32024, message: "revoked" },
      });
      t.result(m.id, { _meta: {} });
    });
    const out = await conn.streamEvents(
      { name: "note.created" },
      { onActive: () => undefined, onEvent: () => undefined }
    );
    expect(out).toEqual({
      end: "terminated",
      cursor: null,
      error: { code: -32024, message: "revoked" },
    });
  });

  it("routes list_changed to listeners", async () => {
    const { raw, lane } = setup(() => undefined);
    let calls = 0;
    lane.onListChanged(() => calls++);
    raw.emit({
      jsonrpc: "2.0",
      method: "notifications/events/list_changed",
      params: {},
    });
    expect(calls).toBe(1);
  });

  it("refuses the SDK events extension", () => {
    const lane = createSdkClientEventsAdapter();
    expect(() =>
      lane.checkExtensions([{ id: "io.modelcontextprotocol/events" }])
    ).toThrow(
      expect.objectContaining({ code: "EVENTS_SDK_EXTENSION_CONFLICT" })
    );
  });
});
