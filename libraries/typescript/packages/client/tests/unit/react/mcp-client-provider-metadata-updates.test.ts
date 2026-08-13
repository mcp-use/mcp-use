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
const authenticateSpies: Array<ReturnType<typeof vi.fn>> = [];
let latestClient: ReturnType<typeof useMcpClient> | null = null;
let mockState: "discovering" | "pending_auth" | "ready" | "failed" = "ready";
let mockProtocolEra: "legacy" | "modern" = "legacy";
let mockInstructions = "legacy instructions";
let mockAuthorization: { mode: "mixed"; authenticated: boolean } | undefined;
let mockSkills: Array<{
  uri: string;
  frontmatter: { name: string; description: string };
  resources: unknown[];
}> = [];

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
      const authenticate = React.useMemo(
        () => vi.fn().mockResolvedValue(undefined),
        []
      );

      useEffect(() => {
        mountCount += 1;
        disconnectSpies.push(disconnect);
        clearStorageSpies.push(clearStorage);
        authenticateSpies.push(authenticate);
      }, [disconnect, clearStorage]);

      return {
        name: "sandbox",
        tools,
        resources,
        resourceTemplates,
        prompts,
        skills: mockSkills,
        serverInfo,
        capabilities,
        state: mockState,
        error: undefined,
        authUrl: undefined,
        authTokens: undefined,
        authorization: mockAuthorization,
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
        authenticate,
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
    authenticateSpies.length = 0;
    latestClient = null;
    mockState = "ready";
    mockProtocolEra = "legacy";
    mockInstructions = "legacy instructions";
    mockAuthorization = undefined;
    mockSkills = [];
    vi.restoreAllMocks();
  });

  it("atomically tears down, clears credentials, remounts, and authenticates", async () => {
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

    const firstDisconnect = disconnectSpies[0];
    const firstClearStorage = clearStorageSpies[0];
    const order: string[] = [];
    firstDisconnect.mockImplementation(async () => {
      order.push("disconnect:start");
      await Promise.resolve();
      order.push("disconnect:end");
    });
    firstClearStorage.mockImplementation(() => {
      order.push("clearStorage");
    });

    mockState = "discovering";
    let reauthentication: Promise<void> | undefined;
    await act(async () => {
      reauthentication = latestClient!.reauthenticateServer("sandbox");
      await expect(
        latestClient!.reauthenticateServer("sandbox")
      ).rejects.toThrow("Reauthentication is already in progress");
      await Promise.resolve();
    });
    await flushUpdates();
    expect(authenticateSpies[1]).not.toHaveBeenCalled();

    mockState = "pending_auth";
    await act(async () => {
      renderer!.update(
        React.createElement(
          McpClientProvider,
          null,
          React.createElement(TestHarness)
        )
      );
    });
    await act(async () => {
      await reauthentication;
    });

    expect(order).toEqual([
      "disconnect:start",
      "disconnect:end",
      "clearStorage",
    ]);
    expect(mountCount).toBe(2);
    expect(authenticateSpies[0]).not.toHaveBeenCalled();
    expect(authenticateSpies[1]).toHaveBeenCalledTimes(1);
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

  it("propagates mixed-auth metadata to provider consumers", async () => {
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

    expect(latestClient?.getServer("sandbox")?.authorization).toBeUndefined();
    mockAuthorization = { mode: "mixed", authenticated: false };

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

    expect(latestClient?.getServer("sandbox")?.authorization).toEqual({
      mode: "mixed",
      authenticated: false,
    });
  });

  it("propagates refreshed skills to provider consumers", async () => {
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

    expect(latestClient?.getServer("sandbox")?.skills).toEqual([]);
    mockSkills = [
      {
        uri: "skill://shipping/SKILL.md",
        frontmatter: {
          name: "shipping",
          description: "Track shipments",
        },
        resources: [],
      },
    ];

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

    expect(latestClient?.getServer("sandbox")?.skills).toEqual(mockSkills);
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
          headers: { Authorization: "Bearer runtime-only" },
          proxyConfig: {
            proxyAddress: "https://proxy.example.com",
            headers: { Authorization: "Bearer proxy-runtime-only" },
          },
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
    expect(stored.headers).toBeUndefined();
    expect(stored.proxyConfig).toEqual({
      proxyAddress: "https://proxy.example.com",
    });
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
