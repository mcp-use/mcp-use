import React, { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import {
  McpClientProvider,
  useMcpClient,
} from "../../../src/react/McpClientProvider.js";
import { MemoryStorageProvider } from "../../../src/react/storage.js";

let mountCount = 0;
const disconnectSpies: Array<ReturnType<typeof vi.fn>> = [];
const clearStorageSpies: Array<ReturnType<typeof vi.fn>> = [];
let latestClient: ReturnType<typeof useMcpClient> | null = null;
let mockProtocolEra: "legacy" | "modern" = "legacy";
let mockInstructions = "legacy instructions";

vi.mock("../../../src/react/useMcp.js", () => {
  const tools: unknown[] = [];
  const resources: unknown[] = [];
  const resourceTemplates: unknown[] = [];
  const prompts: unknown[] = [];
  const serverInfo = { name: "sandbox", version: "1.0.0" };
  const capabilities = {};
  const client = { id: "mock-client" };
  const log: unknown[] = [];

  return {
    useMcp: () => {
      const disconnect = React.useMemo(() => vi.fn(), []);
      const clearStorage = React.useMemo(() => vi.fn(), []);

      useEffect(() => {
        mountCount += 1;
        disconnectSpies.push(disconnect);
        clearStorageSpies.push(clearStorage);
      }, [disconnect, clearStorage]);

      return {
        name: "sandbox",
        tools,
        resources,
        resourceTemplates,
        prompts,
        serverInfo,
        capabilities,
        state: "ready" as const,
        error: undefined,
        authUrl: undefined,
        authTokens: undefined,
        protocolEra: mockProtocolEra,
        protocolVersion:
          mockProtocolEra === "legacy" ? "2025-11-25" : "2026-07-28",
        instructions: mockInstructions,
        extensions: {},
        log,
        callTool: vi.fn(),
        refresh: vi.fn(),
        reconnect: vi.fn(),
        disconnect,
        clearStorage,
        client,
      };
    },
  };
});

function TestHarness() {
  const client = useMcpClient();
  const addedRef = useRef(false);

  latestClient = client;

  useEffect(() => {
    if (!client.storageLoaded || addedRef.current) {
      return;
    }

    addedRef.current = true;
    client.addServer("sandbox", {
      url: "http://localhost:3000/mcp",
      displayName: "Sandbox MCP Server",
    });
  }, [client]);

  return null;
}

async function flushUpdates() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("McpClientProvider metadata-only updates", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    mountCount = 0;
    disconnectSpies.length = 0;
    clearStorageSpies.length = 0;
    latestClient = null;
    mockProtocolEra = "legacy";
    mockInstructions = "legacy instructions";
    vi.restoreAllMocks();
  });

  it("updates configured server metadata without reconnecting", async () => {
    await act(async () => {
      create(
        React.createElement(
          McpClientProvider,
          null,
          React.createElement(TestHarness)
        )
      );
    });

    await flushUpdates();
    await flushUpdates();

    const client = latestClient;

    expect(client).toBeTruthy();
    expect(client?.getServer("sandbox")?.displayName).toBe(
      "Sandbox MCP Server"
    );
    expect(mountCount).toBe(1);

    let updatePromise: Promise<void> | undefined;
    act(() => {
      updatePromise = client?.updateServerMetadata("sandbox", {
        name: "Sandbox Alias",
      });
    });
    await updatePromise;

    await flushUpdates();

    expect(latestClient?.getServer("sandbox")?.displayName).toBe(
      "Sandbox Alias"
    );
    expect(disconnectSpies[0]).not.toHaveBeenCalled();
    expect(clearStorageSpies[0]).not.toHaveBeenCalled();
    expect(mountCount).toBe(1);
  });

  it("propagates protocol-only metadata updates to provider consumers", async () => {
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          McpClientProvider,
          null,
          React.createElement(TestHarness)
        )
      );
    });
    await flushUpdates();

    expect(latestClient?.getServer("sandbox")?.protocolEra).toBe("legacy");
    mockProtocolEra = "modern";
    mockInstructions = "modern instructions";

    await act(async () => {
      renderer!.update(
        React.createElement(
          McpClientProvider,
          null,
          React.createElement(TestHarness)
        )
      );
    });
    await flushUpdates();

    expect(latestClient?.getServer("sandbox")?.protocolEra).toBe("modern");
    expect(latestClient?.getServer("sandbox")?.instructions).toBe(
      "modern instructions"
    );
  });

  it("persists only serializable server configuration", async () => {
    const storage = new MemoryStorageProvider();

    function PersistedServer() {
      const client = useMcpClient();
      const addedRef = useRef(false);
      useEffect(() => {
        if (!client.storageLoaded || addedRef.current) return;
        addedRef.current = true;
        client.addServer("persisted", {
          url: "http://localhost:3000/mcp",
          authProvider: { tokens: async () => undefined } as any,
          fetch: vi.fn(),
          wrapTransport: ((transport: any) => transport) as any,
          onPopupWindow: vi.fn(),
          onSamplingRequest: vi.fn(),
        });
      }, [client]);
      return null;
    }

    await act(async () => {
      create(
        React.createElement(
          McpClientProvider,
          { storageProvider: storage },
          React.createElement(PersistedServer)
        )
      );
    });
    await flushUpdates();
    await flushUpdates();

    const stored = storage.getServers().persisted as Record<string, unknown>;
    expect(stored.url).toBe("http://localhost:3000/mcp");
    expect(stored.authProvider).toBeUndefined();
    expect(stored.fetch).toBeUndefined();
    expect(stored.wrapTransport).toBeUndefined();
    expect(stored.onPopupWindow).toBeUndefined();
    expect(stored.onSamplingRequest).toBeUndefined();
  });

  it("keeps updateServer as a reconnecting update path but preserves OAuth credentials", async () => {
    await act(async () => {
      create(
        React.createElement(
          McpClientProvider,
          null,
          React.createElement(TestHarness)
        )
      );
    });

    await flushUpdates();
    await flushUpdates();

    const client = latestClient;

    expect(client).toBeTruthy();
    expect(client?.getServer("sandbox")?.displayName).toBe(
      "Sandbox MCP Server"
    );
    expect(mountCount).toBe(1);

    let updatePromise: Promise<void> | undefined;
    act(() => {
      updatePromise = client?.updateServer("sandbox", {
        headers: {
          Authorization: "Bearer token",
        },
      });
    });
    await updatePromise;

    await flushUpdates();
    await flushUpdates();

    expect(disconnectSpies[0]).toHaveBeenCalledTimes(1);
    // updateServer reconnects (remount) to apply new options, but must NOT
    // wipe persisted OAuth credentials — editing options is not a logout.
    expect(clearStorageSpies[0]).not.toHaveBeenCalled();
    expect(mountCount).toBeGreaterThan(1);
  });

  it("removeServer preserves OAuth credentials by default, but clears them on explicit logout", async () => {
    await act(async () => {
      create(
        React.createElement(
          McpClientProvider,
          null,
          React.createElement(TestHarness)
        )
      );
    });

    await flushUpdates();
    await flushUpdates();

    const client = latestClient;
    expect(client).toBeTruthy();
    expect(client?.getServer("sandbox")).toBeTruthy();

    // Default removal: connection torn down, credentials preserved.
    act(() => {
      client?.removeServer("sandbox");
    });
    await flushUpdates();

    expect(disconnectSpies[0]).toHaveBeenCalledTimes(1);
    expect(clearStorageSpies[0]).not.toHaveBeenCalled();
    expect(latestClient?.getServer("sandbox")).toBeUndefined();

    // Re-add and remove with explicit logout: credentials wiped this time.
    act(() => {
      latestClient?.addServer("sandbox", {
        url: "http://localhost:3000/mcp",
        displayName: "Sandbox MCP Server",
      });
    });
    await flushUpdates();
    await flushUpdates();

    act(() => {
      latestClient?.removeServer("sandbox", { clearCredentials: true });
    });
    await flushUpdates();

    const lastClearStorage = clearStorageSpies[clearStorageSpies.length - 1];
    expect(lastClearStorage).toHaveBeenCalledTimes(1);
  });
});
