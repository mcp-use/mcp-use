import { describe, expect, it, vi } from "vitest";
import type { BrowserMCPClient } from "../../../src/core/browser.js";
import type { MCPConnection } from "../../../src/core/session.js";
import {
  attachLifecycleConnection,
  closeRetiredLifecycleAfterConnectFailure,
  commitLifecycle,
  createConnectionLifecycle,
  isCurrentLifecycle,
  retireLifecycle,
  type ConnectionLifecycleRef,
  type UseMcpAuthProvider,
} from "../../../src/react/useMcp-lifecycle.js";

function makeLifecycle() {
  const client = {
    closeSession: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserMCPClient;
  const authProvider = {} as UseMcpAuthProvider;

  const lifecycle = createConnectionLifecycle({
    id: 1,
    trigger: "configuration",
    serverName: "inspector-server",
    client,
    authProvider,
    snapshot: { url: "https://example.test/mcp" },
  });
  lifecycle.started = true;
  return lifecycle;
}

describe("useMcp lifecycle ownership", () => {
  it("does not commit from a retired lifecycle", () => {
    const lifecycle = makeLifecycle();
    const ref: ConnectionLifecycleRef<{ url: string }> = { current: lifecycle };
    const commit = vi.fn();

    expect(isCurrentLifecycle(ref, lifecycle)).toBe(true);
    expect(commitLifecycle(ref, lifecycle, commit)).toBe(true);

    void retireLifecycle(lifecycle);

    expect(isCurrentLifecycle(ref, lifecycle)).toBe(false);
    expect(commitLifecycle(ref, lifecycle, commit)).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("closes again when connect resolves after retirement", async () => {
    const lifecycle = makeLifecycle();
    const client = lifecycle.client as unknown as {
      closeSession: ReturnType<typeof vi.fn>;
    };

    await retireLifecycle(lifecycle);
    expect(client.closeSession).toHaveBeenCalledTimes(1);

    const lateConnection = {} as MCPConnection;
    await attachLifecycleConnection(lifecycle, lateConnection);

    expect(lifecycle.connection).toBe(lateConnection);
    expect(client.closeSession).toHaveBeenCalledTimes(2);
    expect(lifecycle.phase).toBe("retired");
  });

  it("does not duplicate teardown for repeated retirement", async () => {
    const lifecycle = makeLifecycle();
    const client = lifecycle.client as unknown as {
      closeSession: ReturnType<typeof vi.fn>;
    };

    await Promise.all([retireLifecycle(lifecycle), retireLifecycle(lifecycle)]);

    expect(client.closeSession).toHaveBeenCalledTimes(1);
  });

  it("closes again when a pending attempt rejects after retirement", async () => {
    const lifecycle = makeLifecycle();
    const client = lifecycle.client as unknown as {
      closeSession: ReturnType<typeof vi.fn>;
    };

    await retireLifecycle(lifecycle);
    await closeRetiredLifecycleAfterConnectFailure(lifecycle);

    expect(client.closeSession).toHaveBeenCalledTimes(2);
  });

  it("does not close a Strict Mode preflight lifecycle that never started", async () => {
    const lifecycle = makeLifecycle();
    const client = lifecycle.client as unknown as {
      closeSession: ReturnType<typeof vi.fn>;
    };
    lifecycle.started = false;

    await retireLifecycle(lifecycle);

    expect(client.closeSession).not.toHaveBeenCalled();
    expect(lifecycle.phase).toBe("retired");
  });
});
