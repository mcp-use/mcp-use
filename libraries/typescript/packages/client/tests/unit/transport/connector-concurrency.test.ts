import type { Client } from "@modelcontextprotocol/client";
import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { BaseConnector } from "../../../src/transport/base.js";
import type { ConnectionManager } from "../../../src/transport/connection-manager.js";
import { deferred } from "../../helpers/deferred.js";

// Fake only resource acquisition. BaseConnector performs the actual lifecycle
// coordination and cleanup, including calling close() and stop().
class TestConnector extends BaseConnector {
  handshake = Promise.resolve();
  cleanup = Promise.resolve();
  cleanupStarted = deferred();
  connections: Array<Pick<Client, "close"> & Pick<ConnectionManager, "stop">> =
    [];

  get publicIdentifier() {
    return { type: "test" };
  }

  protected override async establishTransport() {
    const connection = {
      close: vi.fn(async () => {
        this.cleanupStarted.resolve();
        await this.cleanup;
      }),
      stop: vi.fn(async () => {}),
    };
    this.connections.push(connection);
    this.client = connection as unknown as Client;
    this.connectionManager = connection as unknown as ConnectionManager;
    await this.handshake;
  }
}

async function expectPending(...promises: Promise<void>[]) {
  const settled = vi.fn();
  for (const promise of promises) void promise.then(settled, settled);
  // Drain ready work while the test's handshake/cleanup gate stays closed.
  await setImmediate();
  expect(settled).not.toHaveBeenCalled();
}

function expectClosed(connector: TestConnector) {
  expect(connector.isClientConnected).toBe(false);
  for (const connection of connector.connections) {
    expect(connection.close).toHaveBeenCalledOnce();
    expect(connection.stop).toHaveBeenCalledOnce();
  }
}

describe("connector lifecycle", () => {
  it("shares one handshake and keeps every connect caller pending until it finishes", async () => {
    const connector = new TestConnector();
    const handshake = deferred();
    connector.handshake = handshake.promise;

    const connects = [
      connector.connect(),
      connector.connect(),
      connector.connect(),
    ];
    await expectPending(...connects);
    expect(connector.connections).toHaveLength(1);

    handshake.resolve();
    await Promise.all(connects);
    await connector.connect();
    expect(connector.connections).toHaveLength(1);
    expect(connector.isClientConnected).toBe(true);
    await connector.disconnect();
    expectClosed(connector);
  });

  it("shares one teardown and keeps every disconnect caller pending until resources close", async () => {
    const connector = new TestConnector();
    await connector.disconnect();
    expect(connector.connections).toHaveLength(0);
    await connector.connect();
    const cleanup = deferred();
    connector.cleanup = cleanup.promise;

    const disconnects = [
      connector.disconnect(),
      connector.disconnect(),
      connector.disconnect(),
    ];
    await connector.cleanupStarted.promise;
    await expectPending(...disconnects);
    expect(connector.connections[0].close).toHaveBeenCalledOnce();
    expect(connector.connections[0].stop).not.toHaveBeenCalled();

    cleanup.resolve();
    await Promise.all(disconnects);
    await connector.disconnect();
    expectClosed(connector);
  });

  it("closes resources before rejecting a connection cancelled during its handshake", async () => {
    const connector = new TestConnector();
    const handshake = deferred();
    const cleanup = deferred();
    connector.handshake = handshake.promise;
    connector.cleanup = cleanup.promise;

    const connect = connector.connect();
    const disconnect = connector.disconnect();
    const cancelled = expect(connect).rejects.toThrow(
      "Connection cancelled by disconnect"
    );
    handshake.resolve();
    await connector.cleanupStarted.promise;
    await expectPending(connect, disconnect);

    cleanup.resolve();
    await Promise.all([cancelled, disconnect]);
    expect(connector.connections).toHaveLength(1);
    expectClosed(connector);
  });

  it("starts one fresh connection only after the preceding teardown finishes", async () => {
    const connector = new TestConnector();
    await connector.connect();
    const cleanup = deferred();
    connector.cleanup = cleanup.promise;

    const disconnect = connector.disconnect();
    const reconnects = [connector.connect(), connector.connect()];
    await connector.cleanupStarted.promise;
    await expectPending(...reconnects);
    expect(connector.connections).toHaveLength(1);

    cleanup.resolve();
    await Promise.all([disconnect, ...reconnects]);
    expect(connector.connections).toHaveLength(2);
    expect(connector.connections[0].stop).toHaveBeenCalledOnce();
    expect(connector.connections[1].close).not.toHaveBeenCalled();
    expect(connector.isClientConnected).toBe(true);
    await connector.disconnect();
    expectClosed(connector);
  });

  it("cancels a queued reconnect when a later disconnect joins the teardown", async () => {
    const connector = new TestConnector();
    await connector.connect();
    const cleanup = deferred();
    connector.cleanup = cleanup.promise;

    const firstDisconnect = connector.disconnect();
    const reconnect = connector.connect();
    const finalDisconnect = connector.disconnect();
    const cancelled = expect(reconnect).rejects.toThrow(
      "Connection cancelled by disconnect"
    );
    cleanup.resolve();
    await Promise.all([firstDisconnect, finalDisconnect, cancelled]);

    expect(connector.connections).toHaveLength(1);
    expectClosed(connector);
  });

  it("cancels both connects in connect/disconnect/connect/disconnect", async () => {
    const connector = new TestConnector();
    const handshake = deferred();
    connector.handshake = handshake.promise;

    const firstConnect = connector.connect();
    const firstDisconnect = connector.disconnect();
    const reconnect = connector.connect();
    const finalDisconnect = connector.disconnect();
    const cancelled = [firstConnect, reconnect].map((attempt) =>
      expect(attempt).rejects.toThrow("Connection cancelled by disconnect")
    );
    handshake.resolve();
    await Promise.all([firstDisconnect, finalDisconnect, ...cancelled]);

    expect(connector.connections).toHaveLength(1);
    expectClosed(connector);
  });

  it("allows a newer reconnect without letting a cancelled queued call close it", async () => {
    const connector = new TestConnector();
    await connector.connect();
    const cleanup = deferred();
    connector.cleanup = cleanup.promise;

    const firstDisconnect = connector.disconnect();
    const staleReconnect = connector.connect();
    const finalDisconnect = connector.disconnect();
    const freshReconnect = connector.connect();
    const cancelled = expect(staleReconnect).rejects.toThrow(
      "Connection cancelled by disconnect"
    );
    cleanup.resolve();
    await Promise.all([
      firstDisconnect,
      finalDisconnect,
      cancelled,
      freshReconnect,
    ]);

    expect(connector.connections).toHaveLength(2);
    expect(connector.connections[0].stop).toHaveBeenCalledOnce();
    expect(connector.connections[1].close).not.toHaveBeenCalled();
    expect(connector.isClientConnected).toBe(true);
    await connector.disconnect();
    expectClosed(connector);
  });

  it("cleans up an allocated connection before sharing handshake failure, then permits retry", async () => {
    const connector = new TestConnector();
    const handshake = deferred();
    const cleanup = deferred();
    connector.handshake = handshake.promise;
    connector.cleanup = cleanup.promise;
    const failure = new Error("Handshake failed");

    const connects = [connector.connect(), connector.connect()];
    const rejected = connects.map((attempt) =>
      expect(attempt).rejects.toBe(failure)
    );
    handshake.reject(failure);
    await connector.cleanupStarted.promise;
    await expectPending(...connects);
    cleanup.resolve();
    await Promise.all(rejected);
    expect(connector.connections).toHaveLength(1);
    expectClosed(connector);

    connector.handshake = Promise.resolve();
    await connector.connect();
    expect(connector.connections).toHaveLength(2);
    expect(connector.isClientConnected).toBe(true);
    await connector.disconnect();
    expectClosed(connector);
  });
});
