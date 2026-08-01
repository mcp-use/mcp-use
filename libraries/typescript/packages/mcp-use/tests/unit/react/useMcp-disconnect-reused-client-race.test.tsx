// @vitest-environment jsdom

/**
 * Regression: connection lifecycle isolation in useMcp (issue #1696).
 * Each connect() gets its own BrowserMCPClient; stale disconnect() teardown
 * must not affect the live connection after a URL/env switch.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

function makeConnector() {
  return {
    tools: [],
    serverInfo: { name: "test-server" },
    serverCapabilities: {},
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

function makeSession() {
  return {
    on: vi.fn(),
    connector: makeConnector(),
    initialize: vi.fn().mockResolvedValue(undefined),
  };
}

type MockClient = {
  id: number;
  addServer: ReturnType<typeof vi.fn>;
  removeServer: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  closeSession: ReturnType<typeof vi.fn>;
};

const createdClients: MockClient[] = [];
let activeSession: ReturnType<typeof makeSession> | null = null;

function createMockClient(id: number): MockClient {
  const client: MockClient = {
    id,
    addServer: vi.fn().mockResolvedValue(undefined),
    removeServer: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockReturnValue([]),
    getSession: vi.fn(() => activeSession),
    createSession: vi.fn(),
    closeSession: vi.fn(),
  };
  client.createSession.mockImplementation(async () => {
    activeSession = makeSession();
    return activeSession;
  });
  client.closeSession.mockImplementation(() => {
    if (!closeSessionDeferred) {
      return Promise.resolve();
    }
    return closeSessionDeferred.promise;
  });
  return client;
}

const BrowserMCPClientMock = vi.fn(function (this: unknown) {
  const client = createMockClient(createdClients.length + 1);
  createdClients.push(client);
  return client;
});

vi.mock("../../../src/client/browser.js", () => ({
  BrowserMCPClient: BrowserMCPClientMock,
}));

vi.mock("../../../src/auth/browser-provider.js", () => ({
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

vi.mock("../../../src/utils/favicon-detector.js", () => ({
  detectFavicon: vi.fn().mockResolvedValue(null),
}));

async function flushConnect() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useMcp connection lifecycle isolation", () => {
  let useMcp: typeof import("../../../src/react/useMcp.js").useMcp;

  beforeEach(async () => {
    vi.clearAllMocks();
    closeSessionDeferred = null;
    activeSession = null;
    createdClients.length = 0;
    mockAuthProvider.serverUrl = "http://localhost/a/mcp";

    vi.resetModules();
    const module = await import("../../../src/react/useMcp.js");
    useMcp = module.useMcp;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new BrowserMCPClient on each connect()", async () => {
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ url }: { url: string }) {
      latest = useMcp({
        url,
        enabled: true,
        authProvider: mockAuthProvider,
        transportType: "http",
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
    await flushConnect();

    expect(createdClients).toHaveLength(1);
    expect(latest?.client).toBe(createdClients[0]);

    await act(async () => {
      renderer!.update(<TestComponent url="http://localhost/b/mcp" />);
    });
    await flushConnect();

    expect(createdClients).toHaveLength(2);
    expect(latest?.client).toBe(createdClients[1]);
    expect(latest?.client).not.toBe(createdClients[0]);
  });

  it("keeps the live client when stale closeSession resolves after a URL switch", async () => {
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ url }: { url: string }) {
      latest = useMcp({
        url,
        enabled: true,
        authProvider: mockAuthProvider,
        transportType: "http",
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
    await flushConnect();

    expect(latest?.state).toBe("ready");
    const firstClient = createdClients[0];

    closeSessionDeferred = createCloseSessionDeferred();
    mockAuthProvider.serverUrl = "http://localhost/b/mcp";

    await act(async () => {
      renderer!.update(<TestComponent url="http://localhost/b/mcp" />);
    });
    await flushConnect();

    const secondClient = createdClients[1];
    expect(latest?.state).toBe("ready");
    expect(latest?.client).toBe(secondClient);

    await act(async () => {
      closeSessionDeferred!.resolve();
      await closeSessionDeferred!.promise;
      await Promise.resolve();
    });

    expect(latest?.state).toBe("ready");
    expect(latest?.client).toBe(secondClient);
    expect(firstClient.closeSession).toHaveBeenCalled();
    expect(secondClient.closeSession).not.toHaveBeenCalled();
  });

  it("creates a fresh client after disconnect() then re-enable", async () => {
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ enabled }: { enabled: boolean }) {
      latest = useMcp({
        url: "http://localhost/a/mcp",
        enabled,
        authProvider: mockAuthProvider,
        transportType: "http",
        autoProxyFallback: false,
        autoRetry: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;

    await act(async () => {
      renderer = create(<TestComponent enabled={true} />);
    });
    await flushConnect();

    const firstClient = createdClients[0];
    expect(latest?.state).toBe("ready");

    await act(async () => {
      latest!.disconnect();
      await Promise.resolve();
    });

    await act(async () => {
      renderer!.update(<TestComponent enabled={false} />);
    });
    await act(async () => {
      renderer!.update(<TestComponent enabled={true} />);
    });
    await flushConnect();

    expect(createdClients).toHaveLength(2);
    expect(latest?.client).toBe(createdClients[1]);
    expect(latest?.client).not.toBe(firstClient);
    expect(latest?.state).toBe("ready");
  });
});
