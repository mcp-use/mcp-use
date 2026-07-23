import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../../src/transport/connection-manager.js";

class TestConnectionManager extends ConnectionManager<{ id: number }> {
  readonly establish = vi.fn(async () => ({ id: 1 }));
  readonly close = vi.fn(async () => {});

  protected establishConnection(): Promise<{ id: number }> {
    return this.establish();
  }

  protected closeConnection(connection: { id: number }): Promise<void> {
    return this.close(connection);
  }
}

describe("ConnectionManager", () => {
  it("coalesces concurrent and repeated starts", async () => {
    const manager = new TestConnectionManager();

    const first = manager.start();
    const second = manager.start();
    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { id: 1 },
      { id: 1 },
    ]);
    await expect(manager.start()).resolves.toEqual({ id: 1 });
    expect(manager.establish).toHaveBeenCalledOnce();

    await manager.stop();
    expect(manager.close).toHaveBeenCalledOnce();
  });

  it("can restart after a completed stop", async () => {
    const manager = new TestConnectionManager();

    await manager.start();
    await manager.stop();
    await manager.start();

    expect(manager.establish).toHaveBeenCalledTimes(2);
    await manager.stop();
  });
});
