import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedisStreamManager } from "../../../src/server/sessions/streams/redis.js";
import type { RedisClient } from "../../../src/server/sessions/stores/redis.js";

function mockRedis() {
  const values = new Map<string, string>();
  const members = new Set<string>();
  const callbacks = new Map<string, (message: string) => void>();
  const client = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string | string[]) => {
      for (const item of Array.isArray(key) ? key : [key]) values.delete(item);
      return 1;
    }),
    exists: vi.fn(async (key: string | string[]) =>
      values.has(String(key)) ? 1 : 0
    ),
    keys: vi.fn(async () => [...values.keys()]),
    expire: vi.fn(async () => true),
    sAdd: vi.fn(async (_key: string, sessionId: string) => {
      members.add(sessionId);
      return 1;
    }),
    sRem: vi.fn(async (_key: string, sessionId: string) => {
      members.delete(sessionId);
      return 1;
    }),
    sMembers: vi.fn(async () => [...members]),
    publish: vi.fn(async (channel: string, data: string) => {
      callbacks.get(channel)?.(data);
      return 1;
    }),
    quit: vi.fn(async () => "OK"),
  } satisfies RedisClient;
  const pubSubClient = {
    ...client,
    subscribe: vi.fn(
      async (channel: string, callback: (data: string) => void) => {
        callbacks.set(channel, callback);
        return 1;
      }
    ),
    unsubscribe: vi.fn(async (channel: string) => {
      callbacks.delete(channel);
      return 1;
    }),
  } satisfies RedisClient;
  return { client, pubSubClient, callbacks, values, members };
}
function controller() {
  return {
    enqueue: vi.fn(),
    close: vi.fn(),
    error: vi.fn(),
    desiredSize: 1,
  } as unknown as ReadableStreamDefaultController;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Redis stream lifecycle", () => {
  const managers: RedisStreamManager[] = [];
  const failure = new Error("Redis unavailable");
  function setup() {
    const redis = mockRedis();
    const manager = new RedisStreamManager({
      client: redis.client,
      pubSubClient: redis.pubSubClient,
      prefix: "lifecycle:",
      heartbeatInterval: 1,
    });
    managers.push(manager);
    return { ...redis, manager };
  }
  beforeEach(() => {
    vi.useFakeTimers();
    for (const method of ["log", "warn", "error"] as const)
      vi.spyOn(console, method).mockImplementation(() => {});
  });
  afterEach(async () => {
    await Promise.allSettled(
      managers.splice(0).map((manager) => manager.close())
    );
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("stops the disconnected heartbeat and leaves exactly one after reconnect", async () => {
    const { manager, client, callbacks } = setup();
    const old = controller();
    await manager.create("session", old);
    expect(vi.getTimerCount()).toBe(1);
    vi.mocked(old.enqueue).mockImplementation(() => {
      throw new Error("closed");
    });
    await manager.send(["session"], "notification");
    expect(manager.localSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(client.publish).not.toHaveBeenCalledWith(
      "delete:lifecycle:session",
      ""
    );
    const next = controller();
    await manager.create("session", next);
    expect(vi.getTimerCount()).toBe(1);
    expect(callbacks.size).toBe(2);
    await manager.send(["session"], "next");
    expect(next.enqueue).toHaveBeenCalledOnce();
    await manager.delete("session");
    expect(manager.localSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(callbacks.size).toBe(0);
  });
  it.each(["set", "expire", "sAdd"] as const)(
    "rolls back a failed %s registration",
    async (method) => {
      const { manager, client, callbacks, values, members } = setup();
      client[method].mockRejectedValueOnce(failure);
      const stream = controller();
      await expect(manager.create("failed", stream)).rejects.toBe(failure);
      expect(manager.localSize).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(stream.close).toHaveBeenCalledOnce();
      expect(callbacks.size).toBe(0);
      expect(values.has("available:lifecycle:failed")).toBe(false);
      expect(members.has("failed")).toBe(false);
    }
  );
  it.each([1, 2])(
    "rolls back partial channel %s subscription failures repeatedly",
    async (failAt) => {
      const { manager, pubSubClient, callbacks } = setup();
      const subscribe = pubSubClient.subscribe.getMockImplementation()!;
      let calls = 0;
      pubSubClient.subscribe.mockImplementation(async (...args) => {
        const result = await subscribe(...args);
        if (++calls % failAt === 0) throw failure;
        return result;
      });
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(manager.create("failed", controller())).rejects.toBe(
          failure
        );
        expect(manager.localSize).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(callbacks.size).toBe(0);
      }
    }
  );
  it.each(["unsubscribe", "publish", "del", "sRem"] as const)(
    "releases local resources when delete's %s fails",
    async (method) => {
      const { manager, client, pubSubClient } = setup();
      const stream = controller();
      await manager.create("session", stream);
      if (method === "unsubscribe")
        pubSubClient.unsubscribe.mockRejectedValueOnce(failure);
      else client[method].mockRejectedValueOnce(failure);
      await expect(manager.delete("session")).rejects.toBe(failure);
      expect(manager.localSize).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(stream.close).toHaveBeenCalledOnce();
      expect(pubSubClient.unsubscribe).toHaveBeenCalledWith(
        "lifecycle:session"
      );
      expect(pubSubClient.unsubscribe).toHaveBeenCalledWith(
        "delete:lifecycle:session"
      );
      expect(client.del).toHaveBeenCalledWith("available:lifecycle:session");
      expect(client.sRem).toHaveBeenCalledWith("lifecycle:active", "session");
      if (method === "unsubscribe")
        expect(client.publish).not.toHaveBeenCalled();
    }
  );
  it("preserves an identical live controller on duplicate registration", async () => {
    const { manager, callbacks } = setup();
    const stream = controller();
    await manager.create("same", stream);
    await manager.create("same", stream);
    expect(stream.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    expect(callbacks.size).toBe(2);
    await manager.send(["same"], "data");
    expect(stream.enqueue).toHaveBeenCalledOnce();
  });

  it("closes the incoming controller if reconnect unsubscribe fails", async () => {
    const { manager, pubSubClient } = setup();
    const old = controller();
    const incoming = controller();
    await manager.create("same", old);
    pubSubClient.unsubscribe.mockRejectedValueOnce(failure);
    await expect(manager.create("same", incoming)).rejects.toBe(failure);
    expect(old.close).toHaveBeenCalledOnce();
    expect(incoming.close).toHaveBeenCalledOnce();
    expect(manager.localSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes queued controllers rejected after shutdown without deleting foreign availability", async () => {
    const { manager, values } = setup();
    values.set("available:lifecycle:queued", "active");
    const incoming = controller();
    const creating = manager.create("queued", incoming);
    const rejection = expect(creating).rejects.toThrow("closed");
    await manager.close();
    await rejection;
    expect(incoming.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(values.has("available:lifecycle:queued")).toBe(true);
  });

  it("serializes concurrent reconnects and closes the replaced controller", async () => {
    const { manager, callbacks } = setup();
    const first = controller();
    const second = controller();
    await Promise.all([
      manager.create("same", first),
      manager.create("same", second),
    ]);
    expect(first.close).toHaveBeenCalledOnce();
    expect(manager.localSize).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(callbacks.size).toBe(2);
    await manager.send(["same"], "data");
    expect(first.enqueue).not.toHaveBeenCalled();
    expect(second.enqueue).toHaveBeenCalledOnce();
  });
  it("serializes create/delete/create without unsubscribing the reconnect", async () => {
    const { manager, callbacks } = setup();
    const first = controller();
    const second = controller();
    await Promise.all([
      manager.create("same", first),
      manager.delete("same"),
      manager.create("same", second),
    ]);
    expect(first.close).toHaveBeenCalledOnce();
    expect(manager.localSize).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(callbacks.size).toBe(2);
    await manager.send(["same"], "data");
    expect(second.enqueue).toHaveBeenCalledOnce();
  });
  it("closes all owned streams and the response channel after a Redis cleanup failure", async () => {
    const { manager, client, callbacks, values } = setup();
    const first = controller();
    const second = controller();
    await manager.create("one", first);
    await manager.create("two", second);
    manager.onForwardedResponse(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    values.set("available:lifecycle:foreign", "active");
    client.del.mockRejectedValueOnce(failure);
    await expect(manager.close()).rejects.toBe(failure);
    expect(manager.localSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
    expect(values.has("available:lifecycle:two")).toBe(false);
    expect(values.has("available:lifecycle:foreign")).toBe(true);
    expect(client.publish).not.toHaveBeenCalled();
    await expect(manager.create("late", controller())).rejects.toThrow(
      "closed"
    );
  });
  it("never allocates a late heartbeat when close overlaps subscribe", async () => {
    const { manager, pubSubClient, callbacks } = setup();
    const subscribed = deferred();
    const release = deferred();
    const subscribe = pubSubClient.subscribe.getMockImplementation()!;
    pubSubClient.subscribe.mockImplementationOnce(async (...args) => {
      const result = await subscribe(...args);
      subscribed.resolve();
      await release.promise;
      return result;
    });
    const stream = controller();
    const registration = manager.create("in-flight", stream);
    const rejection = expect(registration).rejects.toThrow("closed");
    await subscribed.promise;
    const closing = manager.close();
    expect(stream.close).toHaveBeenCalledOnce();
    release.resolve();
    await rejection;
    await closing;
    expect(manager.localSize).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(callbacks.size).toBe(0);
  });
  it("waits for an in-flight server subscription and clears its handler during close", async () => {
    const { manager, pubSubClient, callbacks } = setup();
    const subscribed = deferred();
    const release = deferred();
    const subscribe = pubSubClient.subscribe.getMockImplementation()!;
    pubSubClient.subscribe.mockImplementationOnce(async (...args) => {
      const result = await subscribe(...args);
      subscribed.resolve();
      await release.promise;
      return result;
    });
    const handler = vi.fn();
    manager.onForwardedResponse(handler);
    await subscribed.promise;
    const closing = manager.close();
    for (const callback of callbacks.values())
      callback('{"response":{},"sessionId":"s"}');
    expect(handler).not.toHaveBeenCalled();
    release.resolve();
    await closing;
    expect(callbacks.size).toBe(0);
  });
  it("does not rebroadcast a deletion from another server", async () => {
    const { manager, callbacks, client } = setup();
    const stream = controller();
    await manager.create("session", stream);
    callbacks.get("delete:lifecycle:session")!("");
    await manager.close();
    expect(stream.close).toHaveBeenCalledOnce();
    expect(client.publish).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
  });
});
