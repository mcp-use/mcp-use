// @vitest-environment jsdom

/**
 * Tests for reference stability in useMcp hook.
 *
 * Verifies that passing unmemoized inline objects (clientInfo, proxyConfig,
 * headers, clientOptions) does not cause infinite reconnection loops on parent re-renders.
 */

import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { UseMcpOptions } from "../../../src/react/types.js";

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
    callTool: vi.fn(),
    readResource: vi.fn(),
    listTools: vi.fn().mockResolvedValue([]),
    listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    listAllSkills: vi.fn().mockResolvedValue({ skills: [] }),
    listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
    getPrompt: vi.fn(),
    complete: vi.fn(),
  };
}

let activeConnection: ReturnType<typeof makeConnection> | null = null;
let addServerCalls: any[] = [];
let removeServerCalls: any[] = [];

const sharedClient = {
  addServer: vi.fn().mockImplementation((config: any) => {
    addServerCalls.push(config);
    return Promise.resolve();
  }),
  removeServer: vi.fn().mockImplementation((id: any) => {
    removeServerCalls.push(id);
    return Promise.resolve();
  }),
  listSessions: vi.fn().mockReturnValue([]),
  getSession: vi.fn(() => activeConnection),
  connect: vi.fn().mockImplementation(() => Promise.resolve(activeConnection)),
  closeSession: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../src/core/browser.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BrowserMCPClient: vi.fn(function () {
    return sharedClient;
  }),
}));

vi.mock("../../../src/auth/browser.js", () => ({
  BrowserOAuthClientProvider: vi.fn(function () {
    return {
      tokens: vi.fn().mockResolvedValue(undefined),
      clearStorage: vi.fn(),
    };
  }),
  createBrowserOAuthProvider: vi.fn(() => ({
    provider: null,
    oauthProxyUrl: undefined,
  })),
}));

vi.mock("../../../src/telemetry/telemetry-browser.js", () => ({
  Tel: {
    getInstance: () => ({
      trackUseMcpConnection: vi.fn().mockResolvedValue(undefined),
      trackUseMcpToolCall: vi.fn().mockResolvedValue(undefined),
      trackUseMcpResourceRead: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../../src/utils/favicon.js", () => ({
  detectFavicon: vi.fn().mockResolvedValue(null),
}));

async function flushMicrotasks(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("useMcp reference stability", () => {
  let useMcp: typeof import("../../../src/react/useMcp.js").useMcp;

  beforeEach(async () => {
    vi.clearAllMocks();
    addServerCalls = [];
    removeServerCalls = [];
    activeConnection = makeConnection();

    vi.resetModules();
    const mod = await import("../../../src/react/useMcp.js");
    useMcp = mod.useMcp;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reconnect when parent re-renders with inline clientInfo", async () => {
    let triggerRender: () => void = () => {};

    function TestComponent() {
      const [count, setCount] = useState(0);
      triggerRender = () => setCount((c) => c + 1);

      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: { name: "Dashboard App", version: "1.0.0" },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent />);
    });
    await flushMicrotasks();

    const initialAddCount = addServerCalls.length;
    expect(initialAddCount).toBeGreaterThan(0);

    const reRender = async () => {
      await act(async () => {
        triggerRender();
      });
      await flushMicrotasks();
    };

    // Re-render multiple times with new inline clientInfo object instances
    for (let i = 0; i < 5; i++) {
      await reRender();
    }

    // Must NOT have added server / reconnected again
    expect(addServerCalls.length).toBe(initialAddCount);
    expect(removeServerCalls.length).toBe(0);

    root.unmount();
  });

  it("does not reconnect when parent re-renders with inline proxyConfig", async () => {
    let triggerRender: () => void = () => {};

    function TestComponent() {
      const [count, setCount] = useState(0);
      triggerRender = () => setCount((c) => c + 1);

      useMcp({
        url: "http://localhost:3000/mcp",
        proxyConfig: { proxyAddress: "https://gateway.example.com" },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent />);
    });
    await flushMicrotasks();

    const initialAddCount = addServerCalls.length;
    expect(initialAddCount).toBeGreaterThan(0);

    const reRender = async () => {
      await act(async () => {
        triggerRender();
      });
      await flushMicrotasks();
    };

    for (let i = 0; i < 5; i++) {
      await reRender();
    }

    expect(addServerCalls.length).toBe(initialAddCount);
    expect(removeServerCalls.length).toBe(0);

    root.unmount();
  });

  it("reconnects when clientInfo properties legitimately change", async () => {
    function TestComponent({ appName }: { appName: string }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: { name: appName },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent appName="AppV1" />);
    });
    await flushMicrotasks();

    const initialAddCount = addServerCalls.length;
    expect(initialAddCount).toBe(1);

    // Change actual name
    await act(async () => {
      root.update(<TestComponent appName="AppV2" />);
    });
    await flushMicrotasks();

    // Now it should have disconnected and reconnected
    expect(addServerCalls.length).toBe(2);
    expect(sharedClient.closeSession).toHaveBeenCalled();

    root.unmount();
  });

  it("does not reconnect when parent re-renders with inline headers", async () => {
    let triggerRender: () => void = () => {};

    function TestComponent() {
      const [count, setCount] = useState(0);
      triggerRender = () => setCount((c) => c + 1);

      useMcp({
        url: "http://localhost:3000/mcp",
        headers: { "x-custom-auth": "secret-token" },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent />);
    });
    await flushMicrotasks();

    const initialAddCount = addServerCalls.length;
    expect(initialAddCount).toBeGreaterThan(0);

    const reRender = async () => {
      await act(async () => {
        triggerRender();
      });
      await flushMicrotasks();
    };

    for (let i = 0; i < 5; i++) {
      await reRender();
    }

    expect(addServerCalls.length).toBe(initialAddCount);

    root.unmount();
  });

  it("does not reconnect when parent re-renders with inline clientOptions", async () => {
    let triggerRender: () => void = () => {};

    function TestComponent() {
      const [count, setCount] = useState(0);
      triggerRender = () => setCount((c) => c + 1);

      useMcp({
        url: "http://localhost:3000/mcp",
        clientOptions: {
          capabilities: {
            roots: { listChanged: true },
          },
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent />);
    });
    await flushMicrotasks();

    const initialAddCount = addServerCalls.length;
    expect(initialAddCount).toBeGreaterThan(0);

    const reRender = async () => {
      await act(async () => {
        triggerRender();
      });
      await flushMicrotasks();
    };

    for (let i = 0; i < 5; i++) {
      await reRender();
    }

    expect(addServerCalls.length).toBe(initialAddCount);

    root.unmount();
  });

  it("reconnects when headers legitimately change", async () => {
    function TestComponent({ token }: { token: string }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        headers: { Authorization: `Bearer ${token}` },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent token="token_v1" />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    // Change to token_v2
    await act(async () => {
      root.update(<TestComponent token="token_v2" />);
    });
    await flushMicrotasks();

    // Must have reconnected with the new token
    expect(addServerCalls.length).toBe(2);
    expect(sharedClient.closeSession).toHaveBeenCalled();

    root.unmount();
  });

  it("reconnects when clientOptions legitimately change", async () => {
    function TestComponent({ rootsEnabled }: { rootsEnabled: boolean }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        clientOptions: {
          capabilities: {
            roots: { listChanged: rootsEnabled },
          },
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent rootsEnabled={false} />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    // Change capabilities
    await act(async () => {
      root.update(<TestComponent rootsEnabled={true} />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(sharedClient.closeSession).toHaveBeenCalled();

    root.unmount();
  });
});
