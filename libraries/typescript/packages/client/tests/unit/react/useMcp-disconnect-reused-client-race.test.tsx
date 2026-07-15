// @vitest-environment jsdom

/**
 * Regression: stale disconnect() must not null clientRef when connect() reuses the
 * same BrowserMCPClient instance and bumps connectEpoch before closeSession resolves.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

function makeConnection() {
  return {
    tools: [],
    info: {
      protocolEra: "legacy",
      protocolVersion: "2025-06-18",
      server: { name: "test-server" },
      capabilities: {},
      extensions: {},
    },
    supports: vi.fn().mockReturnValue(false),
    listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
  };
}

let closeSessionDeferred: {
  promise: Promise<void>;
  resolve: () => void;
} | null = null;

function createCloseSessionDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockAuthProvider = {
  serverUrl: "http://localhost/a/mcp",
  tokens: vi.fn().mockResolvedValue(undefined),
  clearStorage: vi.fn().mockReturnValue(0),
};

/** Single client instance — connect() reuses it when clientRef is non-null. */
let activeConnection: ReturnType<typeof makeConnection> | null = null;

const sharedClient = {
  addServer: vi.fn().mockResolvedValue(undefined),
  removeServer: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockReturnValue([]),
  getSession: vi.fn(() => activeConnection),
  connect: vi.fn(),
  closeSession: vi.fn(),
};

vi.mock("../../../src/core/browser.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BrowserMCPClient: vi.fn(function () {
    return sharedClient;
  }),
}));

vi.mock("../../../src/auth/browser.js", () => ({
  createBrowserOAuthProvider: vi.fn(() => ({
    provider: null,
    oauthProxyUrl: undefined,
  })),
}));

vi.mock("../../../src/telemetry/index.js", () => ({
  Tel: {
    getInstance: () => ({
      trackUseMcpConnection: vi.fn().mockResolvedValue(undefined),
      trackUseMcpToolCall: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../../src/react/favicon.js", () => ({
  detectFavicon: vi.fn().mockResolvedValue(null),
}));

describe("useMcp disconnect vs reused client race", () => {
  let useMcp: typeof import("../../../src/react/useMcp.js").useMcp;

  beforeEach(async () => {
    vi.clearAllMocks();
    closeSessionDeferred = null;
    activeConnection = null;
    mockAuthProvider.serverUrl = "http://localhost/a/mcp";
    sharedClient.connect.mockImplementation(async () => {
      activeConnection = makeConnection();
      return activeConnection;
    });
    sharedClient.closeSession.mockImplementation(() => {
      if (!closeSessionDeferred) {
        return Promise.resolve();
      }
      return closeSessionDeferred.promise;
    });

    vi.resetModules();
    const module = await import("../../../src/react/useMcp.js");
    useMcp = module.useMcp;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps client live when closeSession resolves after a reused-instance reconnect", async () => {
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ url }: { url: string }) {
      latest = useMcp({
        url,
        enabled: true,
        authProvider: mockAuthProvider,
        autoProxyFallback: false,
        autoRetry: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(<TestComponent url="http://localhost/a/mcp" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest?.state).toBe("ready");
    expect(latest?.client).toBe(sharedClient);

    closeSessionDeferred = createCloseSessionDeferred();

    mockAuthProvider.serverUrl = "http://localhost/b/mcp";

    await act(async () => {
      renderer!.update(<TestComponent url="http://localhost/b/mcp" />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest?.state).toBe("ready");
    expect(latest?.client).toBe(sharedClient);

    await act(async () => {
      closeSessionDeferred!.resolve();
      await closeSessionDeferred!.promise;
      await Promise.resolve();
    });

    expect(latest?.state).toBe("ready");
    expect(latest?.client).toBe(sharedClient);
    expect(sharedClient.closeSession).toHaveBeenCalled();
  });
});
