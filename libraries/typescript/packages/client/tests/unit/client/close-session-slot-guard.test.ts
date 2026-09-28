/**
 * Regression: BaseMCPClient.closeSession must only remove the session slot it
 * actually closed. A parallel createSession() (e.g. a URL/env change in useMcp
 * that reuses the same client instance) can write a new session into the same
 * slot while the original session's disconnect() is still awaiting. The old
 * unconditional `delete this.sessions[name]` in the finally block wiped that
 * new session, surfacing as "No active session found" on the next tool call.
 *
 * Run with: pnpm test tests/unit/client/close-session-slot-guard.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { BaseMCPClient } from "../../../src/core/base.js";
import type { BaseConnector } from "../../../src/transport/base.js";
import type { MCPSession } from "../../../src/core/session.js";

class TestMCPClient extends BaseMCPClient {
  protected createConnectorFromConfig(): BaseConnector {
    throw new Error("not needed for these tests");
  }

  protected async createDefaultOAuthProvider(): Promise<never> {
    throw new Error("not needed for these tests");
  }

  /** Test helper to seed/replace a session slot directly. */
  setSession(name: string, session: MCPSession | undefined): void {
    if (session) {
      (this as unknown as { sessions: Record<string, MCPSession> }).sessions[
        name
      ] = session;
    } else {
      delete (this as unknown as { sessions: Record<string, MCPSession> })
        .sessions[name];
    }
  }

  getSessionSlot(name: string): MCPSession | undefined {
    return (this as unknown as { sessions: Record<string, MCPSession> })
      .sessions[name];
  }
}

class InitializingMCPClient extends BaseMCPClient {
  constructor(private readonly connectors: BaseConnector[]) {
    super({
      mcpServers: { server: { url: "https://example.com/mcp", oauth: false } },
    });
  }

  protected createConnectorFromConfig(): BaseConnector {
    const connector = this.connectors.shift();
    if (!connector) throw new Error("No test connector available");
    return connector;
  }

  protected async createDefaultOAuthProvider(): Promise<never> {
    throw new Error("not needed for these tests");
  }
}

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeSession(disconnect: () => Promise<void>): MCPSession {
  return { disconnect: vi.fn(disconnect) } as unknown as MCPSession;
}

describe("BaseMCPClient.closeSession slot guard", () => {
  it("does NOT delete the slot when a newer session replaced it mid-disconnect", async () => {
    const client = new TestMCPClient();
    const deferred = makeDeferred();

    const oldSession = makeSession(() => deferred.promise);
    client.setSession("server", oldSession);
    client.activeSessions = ["server"];

    // Start closing the old session; disconnect() is still pending here.
    const closePromise = client.closeSession("server");

    // A parallel reconnect writes a fresh session into the same slot.
    const newSession = makeSession(() => Promise.resolve());
    client.setSession("server", newSession);

    // Now let the old session's disconnect resolve and the finally block run.
    deferred.resolve();
    await closePromise;

    expect(oldSession.disconnect).toHaveBeenCalledTimes(1);
    // The new session must survive — the stale close must not wipe it.
    expect(client.getSessionSlot("server")).toBe(newSession);
    expect(client.activeSessions).toContain("server");
  });

  it("deletes the slot in the normal (no-race) case", async () => {
    const client = new TestMCPClient();
    const session = makeSession(() => Promise.resolve());
    client.setSession("server", session);
    client.activeSessions = ["server"];

    await client.closeSession("server");

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.getSessionSlot("server")).toBeUndefined();
    expect(client.activeSessions).not.toContain("server");
  });

  it("still clears the slot even if disconnect() throws", async () => {
    const client = new TestMCPClient();
    const session = makeSession(() => Promise.reject(new Error("boom")));
    client.setSession("server", session);
    client.activeSessions = ["server"];

    await client.closeSession("server");

    expect(client.getSessionSlot("server")).toBeUndefined();
    expect(client.activeSessions).not.toContain("server");
  });

  it("closes an active session before removing its server configuration", async () => {
    const client = new TestMCPClient({
      mcpServers: { server: { url: "https://example.com/mcp" } },
    });
    const session = makeSession(() => Promise.resolve());
    client.setSession("server", session);
    client.activeSessions = ["server"];

    await client.removeServer("server");

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.getSession("server")).toBeNull();
    expect(client.getServerNames()).not.toContain("server");
  });

  it("does not install a session after its server is removed during initialization", async () => {
    const initialization = makeDeferred();
    const initializing = makeDeferred();
    const connector = {
      connect: vi.fn(async () => {}),
      initialize: vi.fn(() => {
        initializing.resolve();
        return initialization.promise;
      }),
      disconnect: vi.fn(async () => {}),
    } as unknown as BaseConnector;
    const client = new InitializingMCPClient([connector]);

    const creating = client.createSession("server");
    await initializing.promise;
    expect(connector.initialize).toHaveBeenCalledTimes(1);

    await client.removeServer("server");
    expect(client.getServerNames()).not.toContain("server");

    initialization.resolve();
    await expect(creating).rejects.toThrow(/removed.*during session creation/i);
    expect(client.getSession("server")).toBeNull();
    expect(client.activeSessions).not.toContain("server");
    expect(connector.disconnect).toHaveBeenCalledTimes(1);
  });

  it("allows the same configuration to be added again after removal", async () => {
    const connector = {
      disconnect: vi.fn(async () => {}),
    } as unknown as BaseConnector;
    const client = new InitializingMCPClient([connector]);
    const config = client.getServerConfig("server");
    expect(config).toBeDefined();

    await client.removeServer("server");
    client.addServer("server", config!);

    const session = await client.createSession("server", false);
    expect(client.getSession("server")).toBe(session);
    expect(client.activeSessions).toContain("server");
  });

  it("does not leave a session active when creation starts during removal", async () => {
    const oldDisconnecting = makeDeferred();
    const releaseOldDisconnect = makeDeferred();
    const oldConnector = {
      disconnect: vi.fn(() => {
        oldDisconnecting.resolve();
        return releaseOldDisconnect.promise;
      }),
    } as unknown as BaseConnector;
    const newConnector = {
      disconnect: vi.fn(async () => {}),
    } as unknown as BaseConnector;
    const client = new InitializingMCPClient([oldConnector, newConnector]);

    await client.createSession("server", false);
    const removing = client.removeServer("server");
    await oldDisconnecting.promise;

    // Creation starts while removeServer awaits the old disconnect. Its
    // replacement teardown also awaits that disconnect, so settle both after
    // releasing the barrier and assert only through the public client API.
    const creationOutcome = client.createSession("server", false).then(
      () => "fulfilled",
      () => "rejected"
    );
    releaseOldDisconnect.resolve();
    const outcome = await creationOutcome;
    await removing;

    expect(client.getServerNames()).not.toContain("server");
    expect(client.getSession("server")).toBeNull();
    expect(client.activeSessions).not.toContain("server");
    expect(outcome).toBe("rejected");
  });

  it("allows re-adding the server after its disconnect fails during removal", async () => {
    const oldConnector = {
      disconnect: vi.fn(async () => {
        throw new Error("disconnect failed");
      }),
    } as unknown as BaseConnector;
    const newConnector = {
      disconnect: vi.fn(async () => {}),
    } as unknown as BaseConnector;
    const client = new InitializingMCPClient([oldConnector, newConnector]);
    const config = client.getServerConfig("server");
    expect(config).toBeDefined();

    await client.createSession("server", false);
    await client.removeServer("server");
    expect(client.getSession("server")).toBeNull();

    client.addServer("server", config!);
    const session = await client.createSession("server", false);
    expect(client.getSession("server")).toBe(session);
  });
});
