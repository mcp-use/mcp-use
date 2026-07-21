/**
 * Regression: BaseMCPClient.createSession must disconnect the session it
 * replaces. The session map holds a single slot per server name, so calling
 * createSession() twice for the same server used to overwrite the first
 * session without disconnecting it. The old connector then became unreachable
 * from closeSession()/closeAllSessions(), leaving a stdio child process (or an
 * HTTP session the server never sees terminated) alive for the lifetime of the
 * process.
 *
 * Run with: pnpm test tests/unit/client/create-session-replaces-session.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { BaseMCPClient } from "../../../src/client/base.js";
import type { BaseConnector } from "../../../src/connectors/base.js";
import type { MCPSession } from "../../../src/session.js";

function makeConnector(): BaseConnector {
  return {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    initialize: vi.fn(async () => {}),
  } as unknown as BaseConnector;
}

class TestMCPClient extends BaseMCPClient {
  public readonly connectors: BaseConnector[] = [];

  protected createConnectorFromConfig(): BaseConnector {
    const connector = makeConnector();
    this.connectors.push(connector);
    return connector;
  }

  getSessionSlot(name: string): MCPSession | undefined {
    return (this as unknown as { sessions: Record<string, MCPSession> })
      .sessions[name];
  }
}

function makeClient() {
  return new TestMCPClient({
    mcpServers: { server: { url: "https://example.com/mcp" } },
  });
}

describe("BaseMCPClient.createSession replacing an existing session", () => {
  it("disconnects the session it replaces", async () => {
    const client = makeClient();

    const first = await client.createSession("server", false);
    const second = await client.createSession("server", false);

    expect(second).not.toBe(first);
    expect(client.connectors).toHaveLength(2);
    expect(client.connectors[0].disconnect).toHaveBeenCalledTimes(1);
    expect(client.connectors[1].disconnect).not.toHaveBeenCalled();

    // The new session stays installed and reachable.
    expect(client.getSessionSlot("server")).toBe(second);
    expect(client.activeSessions).toEqual(["server"]);
  });

  it("keeps the new session installed when the replaced session fails to disconnect", async () => {
    const client = makeClient();

    await client.createSession("server", false);
    (
      client.connectors[0].disconnect as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("boom"));

    const second = await client.createSession("server", false);

    expect(client.getSessionSlot("server")).toBe(second);
    expect(client.activeSessions).toEqual(["server"]);
  });

  it("closes every connector when sessions are recreated then closed", async () => {
    const client = makeClient();

    await client.createSession("server", false);
    await client.createSession("server", false);
    await client.closeAllSessions();

    for (const connector of client.connectors) {
      expect(connector.disconnect).toHaveBeenCalled();
    }
    expect(client.activeSessions).toEqual([]);
  });
});
