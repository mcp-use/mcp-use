import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { MCPSession } from "../../../src/core/session.js";
import { StdioConnector } from "../../../src/transport/stdio.js";
import { deferred } from "../../helpers/deferred.js";

class ObservableStdioConnector extends StdioConnector {
  transportStarts = 0;

  protected override async establishTransport(): Promise<void> {
    this.transportStarts++;
    await super.establishTransport();
  }

  get sdkClient() {
    if (!this.client) throw new Error("No SDK client");
    return this.client;
  }

  get manager() {
    if (!this.connectionManager) throw new Error("No connection manager");
    return this.connectionManager;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function fixture(mode?: string, autoConnect = true) {
  const directory = mkdtempSync(join(tmpdir(), "mcp-session-close-"));
  const spawnLog = join(directory, "children.txt");
  writeFileSync(spawnLog, "");
  const pids = () =>
    readFileSync(spawnLog, "utf8").split("\n").filter(Boolean).map(Number);
  const errlog = new PassThrough();
  const connector = new ObservableStdioConnector({
    command: process.execPath,
    args: [
      fileURLToPath(
        new URL(
          "../../fixtures/session-close-stdio-server.mjs",
          import.meta.url
        )
      ),
      spawnLog,
      ...(mode ? [mode] : []),
    ],
    errlog,
  });
  const session = new MCPSession(connector, autoConnect);
  onTestFinished(async () => {
    try {
      for (const pid of pids()) {
        if (isAlive(pid)) process.kill(pid, "SIGKILL");
      }
      await session.disconnect();
      await vi.waitFor(() => expect(pids().filter(isAlive)).toEqual([]));
    } finally {
      errlog.destroy();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  return { session, connector, pids, errlog };
}

function observeClose(connector: ObservableStdioConnector) {
  const client = connector.sdkClient;
  const previous = client.onclose;
  const closed = deferred();
  client.onclose = () => {
    previous?.();
    closed.resolve();
  };
  return closed.promise;
}

async function expectPing(session: MCPSession, pid: number) {
  expect(await session.callTool("ping", {})).toMatchObject({
    content: [{ type: "text", text: String(pid) }],
  });
}

describe("stdio session after server exit", () => {
  it("reuses an established client across repeated initialization", async () => {
    const { session, connector, pids } = fixture();
    await session.initialize();
    const client = connector.sdkClient;
    await Promise.all([session.initialize(), session.initialize()]);
    expect(connector.transportStarts).toBe(1);
    expect(connector.sdkClient).toBe(client);
    await expectPing(session, pids()[0]);
  });

  it("keeps reconnection explicit when autoConnect is disabled", async () => {
    const { session, connector, pids } = fixture(undefined, false);
    await expect(session.initialize()).rejects.toThrow("not connected");
    expect(connector.transportStarts).toBe(0);
    await session.connect();
    await session.initialize();
    await expectPing(session, pids()[0]);
    await session.disconnect();
    await expect(session.initialize()).rejects.toThrow("not connected");
    expect(connector.transportStarts).toBe(1);
    await session.connect();
    await session.initialize();
    expect(connector.transportStarts).toBe(2);
    await expectPing(session, pids()[1]);
  });

  it("clears idle close state and reconnects with one fresh client and transport", async () => {
    const { session, connector, pids, errlog } = fixture();
    await session.initialize();
    const oldClient = connector.sdkClient;
    const oldTransport = oldClient.transport;
    const connectedListeners = errlog.listenerCount("error");
    await expectPing(session, pids()[0]);
    expect(session.tools.map((tool) => tool.name)).toEqual(["ping", "exit"]);

    const closed = observeClose(connector);
    process.kill(pids()[0], "SIGTERM");
    await closed;
    await vi.waitFor(() => {
      expect(session.isConnected).toBe(false);
      expect(errlog.listenerCount("error")).toBe(0);
      expect(pids().filter(isAlive)).toEqual([]);
    });
    expect(() => session.tools).toThrow("not initialized");

    await Promise.all([
      session.connect(),
      session.connect(),
      session.connect(),
    ]);
    expect(pids()).toHaveLength(2);
    expect(connector.sdkClient).not.toBe(oldClient);
    expect(connector.sdkClient.transport).not.toBe(oldTransport);
    await session.initialize();
    expect(session.isConnected).toBe(true);
    await expectPing(session, pids()[1]);
    expect(errlog.listenerCount("error")).toBe(connectedListeners);
  });

  it("rejects an in-flight call on exit and allows initialize to reconnect", async () => {
    const { session, connector, pids } = fixture();
    await session.initialize();
    const oldClient = connector.sdkClient;
    const closed = observeClose(connector);
    await expect(session.callTool("exit", {})).rejects.toThrow(
      "Connection closed"
    );
    await closed;
    await vi.waitFor(() => expect(session.isConnected).toBe(false));
    expect(pids()).toHaveLength(1);

    await session.initialize();
    expect(pids()).toHaveLength(2);
    expect(connector.sdkClient).not.toBe(oldClient);
    await expectPing(session, pids()[1]);
  });

  it("waits for client close before initializing a fresh session", async () => {
    const { session, connector, pids } = fixture();
    await session.initialize();
    const oldClient = connector.sdkClient;
    const close = oldClient.close.bind(oldClient);
    const cleanup = deferred();
    const cleanupStarted = deferred();
    vi.spyOn(oldClient, "close").mockImplementation(async () => {
      cleanupStarted.resolve();
      await cleanup.promise;
      await close();
    });
    onTestFinished(() => cleanup.resolve());
    const listTools = vi.spyOn(oldClient, "listTools");
    const closed = observeClose(connector);
    process.kill(pids()[0], "SIGTERM");
    await closed;
    await cleanupStarted.promise;
    expect(connector.sdkClient).toBe(oldClient);

    const initializations = [session.initialize(), session.initialize()];
    const settled = vi.fn();
    for (const initialization of initializations) {
      void initialization.then(settled, settled);
    }
    try {
      await setImmediate();
      expect(listTools).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
      expect(connector.transportStarts).toBe(1);

      cleanup.resolve();
      await Promise.all(initializations);
      expect(connector.transportStarts).toBe(2);
      expect(connector.sdkClient).not.toBe(oldClient);
      await expectPing(session, pids()[1]);
      await vi.waitFor(() => expect(isAlive(pids()[0])).toBe(false));
    } finally {
      cleanup.resolve();
      await Promise.allSettled(initializations);
    }
  });

  it("waits for close cleanup before satisfying concurrent reconnects", async () => {
    const { session, connector, pids, errlog } = fixture();
    await session.initialize();
    const connectedListeners = errlog.listenerCount("error");
    const manager = connector.manager;
    const stop = manager.stop.bind(manager);
    const cleanup = deferred();
    const cleanupStarted = deferred();
    const stopSpy = vi.spyOn(manager, "stop").mockImplementation(async () => {
      cleanupStarted.resolve();
      await cleanup.promise;
      await stop();
    });
    onTestFinished(() => cleanup.resolve());
    const closed = observeClose(connector);
    process.kill(pids()[0], "SIGTERM");
    await closed;

    try {
      await vi.waitFor(() => expect(stopSpy).toHaveBeenCalledOnce());
      await cleanupStarted.promise;
      expect(session.isConnected).toBe(false);
      const reconnects = [
        session.connect(),
        session.connect(),
        session.connect(),
      ];
      const settled = vi.fn();
      for (const reconnect of reconnects) void reconnect.then(settled, settled);
      await setImmediate();
      expect(settled).not.toHaveBeenCalled();
      expect(connector.transportStarts).toBe(1);
      expect(pids()).toHaveLength(1);
      cleanup.resolve();
      await Promise.all(reconnects);
      expect(connector.transportStarts).toBe(2);
      expect(pids()).toHaveLength(2);
      expect(errlog.listenerCount("error")).toBe(connectedListeners);
      await expectPing(session, pids()[1]);
    } finally {
      cleanup.resolve();
    }
  });

  it("preserves an explicit disconnect followed immediately by reconnect", async () => {
    const { session, connector, pids, errlog } = fixture();
    await session.initialize();
    const oldClient = connector.sdkClient;
    const connectedListeners = errlog.listenerCount("error");
    const disconnect = session.disconnect();
    await Promise.all([disconnect, session.connect(), session.connect()]);

    expect(pids()).toHaveLength(2);
    await vi.waitFor(() => expect(isAlive(pids()[0])).toBe(false));
    expect(connector.sdkClient).not.toBe(oldClient);
    expect(session.isConnected).toBe(true);
    expect(errlog.listenerCount("error")).toBe(connectedListeners);
    await expectPing(session, pids()[1]);
    await Promise.all([session.disconnect(), session.disconnect()]);
    expect(session.isConnected).toBe(false);
    expect(errlog.listenerCount("error")).toBe(0);
    await vi.waitFor(() => expect(pids().filter(isAlive)).toEqual([]));
  });

  it("ignores a delayed close callback from an earlier client", async () => {
    const { session, connector, pids } = fixture();
    await session.initialize();
    const oldClose = connector.sdkClient.onclose;
    expect(oldClose).toBeTypeOf("function");
    await session.disconnect();
    await session.initialize();
    const newClient = connector.sdkClient;
    const newTransport = newClient.transport;

    oldClose?.();
    oldClose?.();
    expect(session.isConnected).toBe(true);
    expect(connector.sdkClient).toBe(newClient);
    expect(connector.sdkClient.transport).toBe(newTransport);
    await expectPing(session, pids()[1]);
    await session.connect();
    expect(pids()).toHaveLength(2);
  });

  it.each([
    ["fail-initialize-once", "Initialization failed"],
    ["exit-initialize-once", "Connection closed"],
  ])(
    "cleans up %s and permits a fresh initialization",
    async (mode, message) => {
      const { session, pids, errlog } = fixture(mode);
      await Promise.all(
        [session.connect(), session.connect()].map((attempt) =>
          expect(attempt).rejects.toThrow(message)
        )
      );
      expect(session.isConnected).toBe(false);
      expect(pids()).toHaveLength(1);
      expect(errlog.listenerCount("error")).toBe(0);
      await vi.waitFor(() => expect(pids().filter(isAlive)).toEqual([]));

      await session.initialize();
      expect(pids()).toHaveLength(2);
      expect(session.isConnected).toBe(true);
      await expectPing(session, pids()[1]);
    }
  );
});
