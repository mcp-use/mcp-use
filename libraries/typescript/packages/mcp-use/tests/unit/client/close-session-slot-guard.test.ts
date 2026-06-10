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
import { BaseMCPClient } from "../../../src/client/base.js";
import type { BaseConnector } from "../../../src/connectors/base.js";
import type { MCPSession } from "../../../src/session.js";

class TestMCPClient extends BaseMCPClient {
  protected createConnectorFromConfig(): BaseConnector {
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
});
