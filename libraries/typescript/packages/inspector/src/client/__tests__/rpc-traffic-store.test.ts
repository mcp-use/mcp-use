import { describe, expect, it, vi } from "vitest";
import {
  getRpcCoalesceKey,
  shouldCoalesceWithLast,
} from "../rpc-traffic-coalesce";
import { RpcTrafficStore } from "../rpc-traffic-store";

const entry = (serverId: string) => ({
  source: "mcp" as const,
  serverId,
  direction: "send" as const,
  timestamp: "2026-07-15T00:00:00.000Z",
  message: { jsonrpc: "2.0", method: "tools/list" },
});

const sizeChanged = (
  timestamp: string,
  height: number,
  source: "mcp" | "widget" = "widget"
) => ({
  source,
  serverId: "server-1",
  widgetId: "call-1",
  direction: "send" as const,
  timestamp,
  message: {
    jsonrpc: "2.0",
    method: "ui/notifications/size-changed",
    params: { height },
  },
});

describe("RpcTrafficStore", () => {
  it("keeps only the newest bounded entries", () => {
    const store = new RpcTrafficStore(2);

    store.publish(entry("one"));
    store.publish(entry("two"));
    store.publish(entry("three"));

    expect(store.getSnapshot().map((item) => item.serverId)).toEqual([
      "two",
      "three",
    ]);
  });

  it("notifies subscribers and clears only the selected scope", () => {
    const store = new RpcTrafficStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.publish(entry("one"));
    store.publish({ ...entry("one"), source: "widget" });
    store.publish(entry("two"));

    store.clear({ serverIds: ["one"], sources: ["widget"] });

    expect(
      store.getSnapshot().map(({ serverId, source }) => [serverId, source])
    ).toEqual([
      ["one", "mcp"],
      ["two", "mcp"],
    ]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("coalesces bursty notification traffic into one row with repeatCount", () => {
    const store = new RpcTrafficStore();
    store.publish(sizeChanged("2026-07-15T00:00:00.000Z", 100));
    store.publish(sizeChanged("2026-07-15T00:00:00.050Z", 120));
    store.publish(sizeChanged("2026-07-15T00:00:00.100Z", 140));

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.repeatCount).toBe(3);
    expect(snapshot[0]?.message).toMatchObject({
      params: { height: 140 },
    });
  });

  it("does not coalesce request/response pairs with ids", () => {
    const store = new RpcTrafficStore();
    store.publish({
      ...entry("one"),
      message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    store.publish({
      ...entry("one"),
      message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });

    expect(store.getSnapshot()).toHaveLength(2);
  });
});

describe("rpc traffic coalesce helpers", () => {
  it("builds stable keys for notification methods", () => {
    expect(getRpcCoalesceKey(sizeChanged("2026-07-15T00:00:00.000Z", 1))).toBe(
      "widget|server-1|call-1|send|ui/notifications/size-changed"
    );
  });

  it("respects the coalesce window", () => {
    const last = {
      id: "rpc-1",
      ...sizeChanged("2026-07-15T00:00:00.000Z", 100),
    };
    const next = sizeChanged("2026-07-15T00:00:00.200Z", 120);

    expect(
      shouldCoalesceWithLast(last, next, Date.parse("2026-07-15T00:00:00.250Z"))
    ).toBe(true);
    expect(
      shouldCoalesceWithLast(last, next, Date.parse("2026-07-15T00:00:00.400Z"))
    ).toBe(false);
  });
});
