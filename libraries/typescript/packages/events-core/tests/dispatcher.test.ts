import { describe, expect, it } from "vitest";
import {
  createEventsNotificationDispatcher,
  type StreamSink,
} from "../src/index.js";

const SUB = "io.modelcontextprotocol/subscriptionId";

/** A sink that records `[handler, params]` for every frame it receives. */
function recordingSink(): {
  sink: StreamSink;
  frames: Array<[string, unknown]>;
} {
  const frames: Array<[string, unknown]> = [];
  const sink: StreamSink = {
    onActive: (p) => frames.push(["active", p]),
    onEvent: (p) => frames.push(["event", p]),
    onHeartbeat: (p) => frames.push(["heartbeat", p]),
    onError: (p) => frames.push(["error", p]),
    onTerminated: (p) => frames.push(["terminated", p]),
  };
  return { sink, frames };
}

describe("createEventsNotificationDispatcher", () => {
  it("routes every push frame to the stream that owns its _meta subscription id", () => {
    const d = createEventsNotificationDispatcher();
    const seven = recordingSink();
    const other = recordingSink();
    d.own(7, seven.sink);
    d.own("mcp-use:ev:2", other.sink);

    const active = {
      cursor: null,
      truncated: false,
      heartbeatMs: 30000,
      _meta: { [SUB]: 7 },
    };
    const event = {
      eventId: "note_812",
      name: "note.created",
      timestamp: "2026-11-25T10:01:07.000Z",
      data: { noteId: "812" },
      cursor: null,
      _meta: { "vendor/trace": "x", [SUB]: 7 },
    };
    const heartbeat = { cursor: null, _meta: { [SUB]: "mcp-use:ev:2" } };
    const error = {
      error: {
        code: -32603,
        message: "UpstreamError",
        data: { reason: "storage_unavailable" },
      },
      _meta: { [SUB]: 7 },
    };
    const terminated = {
      error: {
        code: -32024,
        message: "Forbidden",
        data: { reason: "revoked" },
      },
      _meta: { [SUB]: 7 },
    };

    expect([
      d.route("notifications/events/active", active),
      d.route("notifications/events/event", event),
      d.route("notifications/events/heartbeat", heartbeat),
      d.route("notifications/events/error", error),
      d.route("notifications/events/terminated", terminated),
    ]).toEqual([true, true, true, true, true]);
    expect(seven.frames).toEqual([
      ["active", active],
      ["event", event],
      ["error", error],
      ["terminated", terminated],
    ]);
    expect(other.frames).toEqual([["heartbeat", heartbeat]]);
  });

  it('treats 7 and "7" as different ids', () => {
    const d = createEventsNotificationDispatcher();
    const numeric = recordingSink();
    d.own(7, numeric.sink);
    expect(
      d.route("notifications/events/heartbeat", {
        cursor: null,
        _meta: { [SUB]: "7" },
      })
    ).toBe(false);
    expect(numeric.frames).toEqual([]);
  });

  it("returns false for other methods, missing _meta and unowned ids", () => {
    const d = createEventsNotificationDispatcher();
    const { sink, frames } = recordingSink();
    d.own(1, sink);
    expect([
      d.route("notifications/progress", { _meta: { [SUB]: 1 } }),
      d.route("notifications/events/event", { eventId: "x" }),
      d.route("notifications/events/event", null),
      d.route("notifications/events/event", { _meta: { [SUB]: { id: 1 } } }),
      d.route("notifications/events/event", { _meta: { [SUB]: 2 } }),
    ]).toEqual([false, false, false, false, false]);
    expect(frames).toEqual([]);
  });

  it("refuses a second owner and stops routing after the owner releases the id", () => {
    const d = createEventsNotificationDispatcher();
    const first = recordingSink();
    const release = d.own(3, first.sink);
    expect(() => d.own(3, recordingSink().sink)).toThrow(
      "Events stream 3 already has an owner"
    );
    release();
    expect(
      d.route("notifications/events/heartbeat", {
        cursor: null,
        _meta: { [SUB]: 3 },
      })
    ).toBe(false);
    const second = recordingSink();
    d.own(3, second.sink);
    expect(
      d.route("notifications/events/heartbeat", {
        cursor: "c",
        _meta: { [SUB]: 3 },
      })
    ).toBe(true);
    expect([first.frames.length, second.frames.length]).toEqual([0, 1]);
  });

  it("calls list_changed listeners until they unsubscribe", () => {
    const d = createEventsNotificationDispatcher();
    expect(d.route("notifications/events/list_changed", {})).toBe(false);
    const calls: string[] = [];
    const offA = d.onListChanged(() => calls.push("a"));
    d.onListChanged(() => calls.push("b"));
    expect(d.route("notifications/events/list_changed", {})).toBe(true);
    offA();
    expect(d.route("notifications/events/list_changed", undefined)).toBe(true);
    expect(calls).toEqual(["a", "b", "b"]);
  });
});
