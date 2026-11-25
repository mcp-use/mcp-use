import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseCodeExecutor } from "../../../src/code-mode/executor.js";
import type { MCPClient } from "../../../src/core/node.js";

class TestExecutor extends BaseCodeExecutor {
  async execute() {
    await this.ensureServersConnected();
    return { result: null, logs: [], error: null, execution_time: 0 };
  }
  async cleanup() {}
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("code executor connection concurrency", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps concurrent execution waiting past five seconds", async () => {
    vi.useFakeTimers();
    const connection = deferred();
    const client = {
      getServerNames: () => ["slow"],
      getAllActiveSessions: () => ({}),
      createAllSessions: vi.fn(() => connection.promise),
    } as unknown as MCPClient;
    const executor = new TestExecutor(client);
    const first = executor.execute();
    let secondFinished = false;
    const second = executor.execute().then(() => {
      secondFinished = true;
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(secondFinished).toBe(false);
    connection.resolve();
    await Promise.all([first, second]);
    expect(client.createAllSessions).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight attempt even if its session is already visible", async () => {
    const connection = deferred();
    let active = false;
    const client = {
      getServerNames: () => ["slow"],
      getAllActiveSessions: () => (active ? { slow: {} } : {}),
      createAllSessions: vi.fn(() => connection.promise),
    } as unknown as MCPClient;
    const executor = new TestExecutor(client);
    const first = executor.execute();
    active = true;
    let secondFinished = false;
    const second = executor.execute().then(() => {
      secondFinished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    connection.resolve();
    await Promise.all([first, second]);
  });

  it("shares connection failures with every waiting execution and permits retry", async () => {
    vi.useFakeTimers();
    const connection = deferred();
    const client = {
      getServerNames: () => ["slow"],
      getAllActiveSessions: () => ({}),
      createAllSessions: vi
        .fn()
        .mockReturnValueOnce(connection.promise)
        .mockResolvedValue(undefined),
    } as unknown as MCPClient;
    const executor = new TestExecutor(client);
    const first = executor.execute();
    const second = executor.execute();
    const results = Promise.allSettled([first, second]);
    const error = new Error("handshake failed");
    connection.reject(error);
    await vi.advanceTimersByTimeAsync(100);
    const settled = await results;
    expect(settled.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    for (const result of settled) {
      if (result.status === "rejected") {
        expect(result.reason).toBe(error);
        expect(result.reason.message).toBe("handshake failed");
      }
    }
    await executor.execute();
    expect(client.createAllSessions).toHaveBeenCalledTimes(2);
  });
});
