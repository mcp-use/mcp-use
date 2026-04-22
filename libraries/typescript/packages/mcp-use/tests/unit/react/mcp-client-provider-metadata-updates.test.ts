import React, { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import {
  McpClientProvider,
  useMcpClient,
} from "../../../src/react/McpClientProvider.js";

let mountCount = 0;
const disconnectSpies: Array<ReturnType<typeof vi.fn>> = [];
const clearStorageSpies: Array<ReturnType<typeof vi.fn>> = [];
let latestClient: ReturnType<typeof useMcpClient> | null = null;

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
      name: "Sandbox MCP Server",
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
    expect(client?.getServer("sandbox")?.name).toBe("Sandbox MCP Server");
    expect(mountCount).toBe(1);

    let updatePromise: Promise<void> | undefined;
    act(() => {
      updatePromise = client?.updateServerMetadata("sandbox", {
        name: "Sandbox Alias",
      });
    });
    await updatePromise;

    await flushUpdates();

    expect(latestClient?.getServer("sandbox")?.name).toBe("Sandbox Alias");
    expect(disconnectSpies[0]).not.toHaveBeenCalled();
    expect(clearStorageSpies[0]).not.toHaveBeenCalled();
    expect(mountCount).toBe(1);
  });

  it("keeps updateServer as a reconnecting update path", async () => {
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
    expect(client?.getServer("sandbox")?.name).toBe("Sandbox MCP Server");
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
    expect(clearStorageSpies[0]).toHaveBeenCalledTimes(1);
    expect(mountCount).toBeGreaterThan(1);
  });
});
