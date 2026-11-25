// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { act, create } from "react-test-renderer";
import {
  createEventsConnection,
  createSdkClientEventsAdapter,
  localStorageEventsStore,
} from "../../src/events/index.js";
import { useMcpEvent } from "../../src/react/useMcpEvent.js";
import {
  ScriptedTransport,
  envelope,
  flush,
} from "../events/scripted-transport.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A Map-backed Storage (the runtime's localStorage may be a stub). */
class MemoryStorage implements Storage {
  #m = new Map<string, string>();
  get length() {
    return this.#m.size;
  }
  clear() {
    this.#m.clear();
  }
  getItem(k: string) {
    return this.#m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.#m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.#m.delete(k);
  }
  setItem(k: string, v: string) {
    this.#m.set(k, v);
  }
  allKeys() {
    return [...this.#m.keys()];
  }
}
const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

function server() {
  const streams: string[] = [];
  const polls: Array<string | null> = [];
  const raw = new ScriptedTransport((m, t) => {
    if (m.method === "initialize")
      t.result(m.id, {
        protocolVersion: "2025-11-25",
        capabilities: { events: {} },
      });
    if (m.method === "events/list")
      t.result(m.id, {
        events: [
          {
            name: "note.created",
            delivery: ["push", "poll"],
            inputSchema: { type: "object" },
          },
        ],
      });
    if (m.method === "events/stream") {
      streams.push(m.id);
      t.frame("notifications/events/active", m.id, {
        cursor: null,
        truncated: false,
        heartbeatMs: 30000,
      });
      t.frame("notifications/events/event", m.id, envelope(1));
    }
    if (m.method === "events/poll") {
      polls.push(m.params.cursor);
      t.result(m.id, {
        events: [],
        cursor: m.params.cursor,
        truncated: false,
        hasMore: false,
        nextPollMs: 60000,
      });
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
  return { conn: createEventsConnection(lane), streams, polls };
}

function Sub(props: {
  mcp: Parameters<typeof useMcpEvent>[0];
  folder: string;
  seen: string[];
  keep?: boolean;
}) {
  useMcpEvent(
    props.mcp,
    "note.created",
    { folder: props.folder },
    (e) => props.seen.push(e.eventId),
    {
      store: localStorageEventsStore("test:"),
      ...(props.keep !== undefined ? { keep: props.keep } : {}),
    }
  );
  return null;
}

describe("useMcpEvent", () => {
  it("delivers pushed events and uses poll for the fifth concurrent subscription", async () => {
    localStorage.clear();
    const s = server();
    await flush();
    const mcp = { eventsConnection: s.conn, state: "ready" };
    const seen: string[] = [];
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(
        <>
          {["a", "b", "c", "d", "e"].map((f) => (
            <Sub key={f} mcp={mcp} folder={f} seen={seen} />
          ))}
        </>
      );
    });
    // Subscriptions start sequentially as each effect resolves its listing.
    await act(async () => {
      await flush(30);
    });
    await act(async () => {
      root.unmount();
    });
    expect(s.streams).toHaveLength(4);
    expect(s.polls).toEqual([null]);
    expect(seen).toEqual(["e1", "e1", "e1", "e1"]);
  });

  it("with keep: true, persists the record in localStorage after unmount", async () => {
    localStorage.clear();
    const s = server();
    await flush();
    const mcp = { eventsConnection: s.conn, state: "ready" };
    const seen: string[] = [];
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<Sub mcp={mcp} folder="inbox" seen={seen} keep />);
    });
    await act(async () => {
      await flush(20);
    });
    await act(async () => {
      root.unmount();
    });
    await flush(5);
    const keys = storage
      .allKeys()
      .filter((k) => k.startsWith("test:sub/default/"));
    expect(keys).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(keys[0]!)!)).toMatchObject({
      v: 1,
      name: "note.created",
      args: { folder: "inbox" },
      recentEventIds: ["e1"],
    });
  });
});
