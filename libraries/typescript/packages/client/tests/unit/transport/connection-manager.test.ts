import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../../src/transport/connection-manager.js";

class TestConnectionManager extends ConnectionManager<{ id: number }> {
  private nextId = 0;
  readonly establish = vi.fn(async () => ({ id: ++this.nextId }));
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

  it("waits for an in-progress stop before restarting", async () => {
    const manager = new TestConnectionManager();
    let releaseFirstClose!: () => void;
    const firstClose = new Promise<void>((resolve) => {
      releaseFirstClose = resolve;
    });
    manager.close.mockImplementation(async ({ id }) => {
      if (id === 1) await firstClose;
    });

    await expect(manager.start()).resolves.toEqual({ id: 1 });
    const stopping = manager.stop();
    await vi.waitFor(() => expect(manager.close).toHaveBeenCalledOnce());

    const restarting = manager.start();
    expect(manager.establish).toHaveBeenCalledOnce();

    releaseFirstClose();
    await stopping;
    await expect(restarting).resolves.toEqual({ id: 2 });
    expect(manager.establish).toHaveBeenCalledTimes(2);

    await manager.stop();
  });
});
