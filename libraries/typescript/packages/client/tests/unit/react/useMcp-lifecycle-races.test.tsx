// @vitest-environment jsdom

/**
 * Public-behavior regression coverage for the hook's connection ownership.
 *
 * These tests deliberately use deferred transport results: React can replace an
 * Effect while its old asynchronous connection is still in flight. Only the
 * lifecycle installed by the latest Effect is allowed to publish state.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { BrowserMCPClient } from "../../../src/core/browser.js";
import { useMcp } from "../../../src/react/useMcp.js";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createBrowserOAuthProvider: vi.fn(),
  startConnectionHealthMonitoring: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function connection(serverName: string) {
  return {
    tools: [],
    info: {
      protocolEra: "legacy" as const,
      protocolVersion: "2025-06-18",
      server: { name: serverName },
      capabilities: {},
      extensions: {},
    },
    supports: vi.fn().mockReturnValue(false),
    listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    listResourceTemplates: vi.fn().mockResolvedValue({
      resourceTemplates: [],
    }),
  };
}

type Connection = ReturnType<typeof connection>;
type ClientPlan = { connect: Promise<Connection> };

const plans: ClientPlan[] = [];
const clients: Array<{
  addServer: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  closeSession: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../../../src/core/browser.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BrowserMCPClient: vi.fn(function () {
    // A stale failure in the current implementation may incorrectly start an
    // extra lifecycle. Keep that observable as an extra client instead of
    // turning it into an unrelated unhandled rejection.
    const plan = plans.shift() ?? {
      connect: Promise.resolve(connection("unexpected-lifecycle")),
    };
    const client = {
      addServer: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockImplementation(() => plan.connect),
      closeSession: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockReturnValue(null),
      listSessions: vi.fn().mockReturnValue([]),
    };
    clients.push(client);
    return client;
  }),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  auth: mocks.auth,
}));

vi.mock("../../../src/telemetry/telemetry-browser.js", () => ({
  Tel: {
    getInstance: () => ({
      trackUseMcpConnection: vi.fn().mockResolvedValue(undefined),
      trackUseMcpToolCall: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../../src/react/useMcp-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createBrowserOAuthProvider: mocks.createBrowserOAuthProvider,
  loadServerIcon: vi.fn().mockResolvedValue(null),
  startConnectionHealthMonitoring: mocks.startConnectionHealthMonitoring,
}));

const authProvider = {
  serverUrl: "http://localhost/a/mcp",
  tokens: vi.fn().mockResolvedValue(undefined),
  clearStorage: vi.fn().mockReturnValue(0),
};

let mountedRenderers: Array<ReturnType<typeof create>> = [];

function mount(element: React.ReactElement) {
  const renderer = create(element);
  mountedRenderers.push(renderer);
  return renderer;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useMcp lifecycle races", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plans.splice(0);
    clients.splice(0);
    authProvider.serverUrl = "http://localhost/a/mcp";
    mocks.auth.mockReset();
    mocks.createBrowserOAuthProvider.mockReset();
    mocks.startConnectionHealthMonitoring.mockReset();
    mocks.startConnectionHealthMonitoring.mockReturnValue(() => {});
  });

  afterEach(() => {
    for (const renderer of mountedRenderers) renderer.unmount();
    mountedRenderers = [];
    vi.useRealTimers();
  });

  it("keeps URL B ready when URL A resolves after B", async () => {
    const a = deferred<Connection>();
    const b = deferred<Connection>();
    plans.push({ connect: a.promise }, { connect: b.promise });
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ url }: { url: string }) {
      latest = useMcp({
        url,
        authProvider,
        autoProxyFallback: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = mount(<TestComponent url="http://localhost/a/mcp" />);
    });
    await act(async () => {
      renderer!.update(<TestComponent url="http://localhost/b/mcp" />);
    });

    await act(async () => {
      b.resolve(connection("server-b"));
      await b.promise;
    });
    await flush();
    expect(latest?.state).toBe("ready");
    expect(latest?.serverInfo?.name).toBe("server-b");

    await act(async () => {
      a.resolve(connection("server-a"));
      await a.promise;
    });
    await flush();

    expect(latest?.state).toBe("ready");
    expect(latest?.serverInfo?.name).toBe("server-b");
    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(2);
    expect(clients).toHaveLength(2);
    expect(clients[0]).not.toBe(clients[1]);
  });

  it("ignores a stale URL-A failure after URL B is ready", async () => {
    const a = deferred<Connection>();
    const b = deferred<Connection>();
    plans.push({ connect: a.promise }, { connect: b.promise });
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ url }: { url: string }) {
      latest = useMcp({
        url,
        authProvider,
        autoReconnect: false,
        autoProxyFallback: {
          enabled: true,
          proxyAddress: "http://localhost/proxy",
        },
        connectionMode: "auto",
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = mount(<TestComponent url="http://localhost/a/mcp" />);
    });
    await act(async () => {
      renderer!.update(<TestComponent url="http://localhost/b/mcp" />);
    });
    await act(async () => {
      b.resolve(connection("server-b"));
      await b.promise;
    });
    await flush();

    await act(async () => {
      a.reject(new Error("Failed to fetch"));
      try {
        await a.promise;
      } catch {
        // The hook handles connection errors internally.
      }
    });
    await flush();

    expect(latest?.state).toBe("ready");
    expect(latest?.serverInfo?.name).toBe("server-b");
    expect(latest?.error).toBeUndefined();
    // In particular, a stale direct failure cannot begin a proxy fallback.
    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(2);
  });

  it("creates one proxy lifecycle with the fallback gateway after a direct failure", async () => {
    const direct = deferred<Connection>();
    const proxied = deferred<Connection>();
    plans.push({ connect: direct.promise }, { connect: proxied.promise });
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent() {
      latest = useMcp({
        url: "http://localhost/a/mcp",
        authProvider,
        autoReconnect: false,
        autoProxyFallback: {
          enabled: true,
          proxyAddress: "http://localhost/proxy",
        },
        connectionMode: "auto",
        logLevel: "silent",
      });
      return null;
    }

    await act(async () => {
      mount(<TestComponent />);
    });
    await act(async () => {
      direct.reject(new Error("Failed to fetch"));
      try {
        await direct.promise;
      } catch {
        // The direct transport failure is the condition under test.
      }
    });
    await flush();

    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(2);
    expect(clients[1].addServer).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ gatewayUrl: "http://localhost/proxy" })
    );

    await act(async () => {
      proxied.resolve(connection("proxied-server"));
      await proxied.promise;
    });
    await flush();
    expect(latest?.state).toBe("ready");
    expect(latest?.serverInfo?.name).toBe("proxied-server");
  });

  it("uses the fresh provider installed by authenticate for its replacement lifecycle", async () => {
    const initial = deferred<Connection>();
    const reconnected = deferred<Connection>();
    plans.push({ connect: initial.promise }, { connect: reconnected.promise });

    const initialProvider = {
      serverUrl: "http://localhost/a/mcp",
      tokens: vi.fn().mockResolvedValue(undefined),
      clearStorage: vi.fn().mockReturnValue(0),
    };
    const freshProvider = {
      serverUrl: "http://localhost/a/mcp",
      tokens: vi.fn().mockResolvedValue(undefined),
      clearStorage: vi.fn().mockReturnValue(0),
    };
    mocks.createBrowserOAuthProvider
      .mockReturnValueOnce({
        provider: initialProvider,
        oauthProxyUrl: undefined,
      })
      .mockReturnValueOnce({
        provider: freshProvider,
        oauthProxyUrl: undefined,
      });
    mocks.auth.mockResolvedValue("AUTHORIZED");

    let latest: ReturnType<typeof useMcp> | undefined;
    function TestComponent() {
      latest = useMcp({
        url: "http://localhost/a/mcp",
        autoProxyFallback: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    await act(async () => {
      mount(<TestComponent />);
    });
    await act(async () => {
      const unauthorized = Object.assign(new Error("Unauthorized"), {
        code: 401,
      });
      initial.reject(unauthorized);
      try {
        await initial.promise;
      } catch {
        // The hook converts an OAuth-capable 401 into pending_auth.
      }
    });
    await flush();
    expect(latest?.state).toBe("pending_auth");

    await act(async () => {
      await latest!.authenticate();
    });
    await flush();

    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(2);
    expect(clients[1].addServer).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ authProvider: freshProvider })
    );

    await act(async () => {
      reconnected.resolve(connection("authenticated-server"));
      await reconnected.promise;
    });
    await flush();
    expect(latest?.state).toBe("ready");
  });

  it("coalesces duplicate OAuth-success messages into one replacement lifecycle", async () => {
    const replacement = deferred<Connection>();
    plans.push(
      { connect: Promise.resolve(connection("initial-server")) },
      { connect: replacement.promise }
    );
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent() {
      latest = useMcp({
        url: "http://localhost/a/mcp",
        authProvider,
        autoProxyFallback: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    await act(async () => {
      mount(<TestComponent />);
    });
    await flush();
    expect(latest?.state).toBe("ready");

    const callback = new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "mcp_auth_callback", success: true },
    });
    await act(async () => {
      window.dispatchEvent(callback);
      window.dispatchEvent(callback);
    });
    await flush();

    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(2);
    expect(clients[1].connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      replacement.resolve(connection("oauth-server"));
      await replacement.promise;
    });
    await flush();
    expect(latest?.state).toBe("ready");
    expect(latest?.serverInfo?.name).toBe("oauth-server");
  });

  it("coalesces repeated health-style reconnect signals while a replacement is connecting", async () => {
    const replacement = deferred<Connection>();
    plans.push(
      { connect: Promise.resolve(connection("initial-server")) },
      { connect: replacement.promise }
    );
    // A health monitor can report the same unhealthy connection through more
    // than one signal. Its public contract is a reconnect callback; invoke it
    // twice after the ready lifecycle has published state.
    mocks.startConnectionHealthMonitoring.mockImplementationOnce(
      ({ connect }) => {
        queueMicrotask(connect);
        queueMicrotask(connect);
        return () => {};
      }
    );
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent() {
      latest = useMcp({
        url: "http://localhost/a/mcp",
        authProvider,
        autoProxyFallback: false,
        autoReconnect: {
          enabled: true,
          healthCheckInterval: 10,
          healthCheckTimeout: 10,
        },
        logLevel: "silent",
      });
      return null;
    }

    await act(async () => {
      mount(<TestComponent />);
    });
    await flush();
    await flush();

    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(2);
    expect(clients[1].connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      replacement.resolve(connection("replacement-server"));
      await replacement.promise;
    });
    await flush();
    expect(latest?.state).toBe("ready");
    expect(latest?.serverInfo?.name).toBe("replacement-server");
  });

  it("does not reconnect for equivalent omitted or inline-empty headers", async () => {
    const initial = deferred<Connection>();
    plans.push({ connect: initial.promise });
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ headers }: { headers?: Record<string, string> }) {
      latest = useMcp({
        url: "http://localhost/a/mcp",
        headers,
        authProvider,
        autoProxyFallback: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = mount(<TestComponent />);
      initial.resolve(connection("server-a"));
      await initial.promise;
    });
    await flush();
    expect(latest?.state).toBe("ready");

    await act(async () => {
      renderer!.update(<TestComponent headers={{}} />);
    });
    await flush();

    expect(latest?.state).toBe("ready");
    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(1);
  });

  it("stays disconnected through an unrelated render", async () => {
    const initial = deferred<Connection>();
    plans.push({ connect: initial.promise });
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ tick }: { tick: number }) {
      latest = useMcp({
        url: "http://localhost/a/mcp",
        authProvider,
        autoProxyFallback: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return <span>{tick}</span>;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = mount(<TestComponent tick={0} />);
      initial.resolve(connection("server-a"));
      await initial.promise;
    });
    await flush();
    expect(latest?.state).toBe("ready");

    await act(async () => {
      await latest!.disconnect();
    });
    await flush();
    expect(latest?.client).toBeNull();

    await act(async () => {
      renderer!.update(<TestComponent tick={1} />);
    });
    await flush();

    expect(latest?.client).toBeNull();
    expect(vi.mocked(BrowserMCPClient)).toHaveBeenCalledTimes(1);
  });

  it("does not allow an older StrictMode connection to publish state", async () => {
    const a = deferred<Connection>();
    const b = deferred<Connection>();
    // React StrictMode runs an extra mount Effect in development. Both
    // preflight lifecycles model URL A; URL B is the subsequent real update.
    plans.push(
      { connect: a.promise },
      { connect: a.promise },
      { connect: b.promise }
    );
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent({ url }: { url: string }) {
      latest = useMcp({
        url,
        authProvider,
        autoProxyFallback: false,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = mount(
        <React.StrictMode>
          <TestComponent url="http://localhost/a/mcp" />
        </React.StrictMode>
      );
    });
    await act(async () => {
      renderer!.update(
        <React.StrictMode>
          <TestComponent url="http://localhost/b/mcp" />
        </React.StrictMode>
      );
    });

    await act(async () => {
      b.resolve(connection("server-b"));
      await b.promise;
    });
    await act(async () => {
      a.resolve(connection("server-a"));
      await a.promise;
    });
    await flush();

    expect(latest?.state).toBe("ready");
    expect(latest?.serverInfo?.name).toBe("server-b");
  });
});
