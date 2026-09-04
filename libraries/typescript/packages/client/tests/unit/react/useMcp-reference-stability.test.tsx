// @vitest-environment jsdom

/**
 * Tests for reference stability in useMcp hook.
 *
 * Verifies that passing unmemoized inline objects (clientInfo, proxyConfig)
 * does not cause infinite reconnection loops on parent re-renders, while legitimate
 * property changes (e.g. name, icons, proxyAddress, headers) trigger reconnects.
 */

import React, { useState } from "react";
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
  addServer: vi
    .fn()
    .mockImplementation((nameOrConfig: any, maybeConfig?: any) => {
      const config = maybeConfig ?? nameOrConfig;
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
  let mountedRoots: Array<{ unmount: () => void }> = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    addServerCalls = [];
    removeServerCalls = [];
    mountedRoots = [];
    activeConnection = makeConnection();

    vi.resetModules();
    const mod = await import("../../../src/react/useMcp.js");
    useMcp = mod.useMcp;
  });

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop();
      try {
        await act(async () => {
          root?.unmount();
        });
      } catch {
        // ignore if already unmounted
      }
    }
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
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

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

    // Must NOT have added server, reconnected, or closed session
    expect(addServerCalls.length).toBe(1);
    expect(sharedClient.closeSession).not.toHaveBeenCalled();
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not reconnect when parent re-renders with inline nested icons in clientInfo", async () => {
    let triggerRender: () => void = () => {};

    function TestComponent() {
      const [count, setCount] = useState(0);
      triggerRender = () => setCount((c) => c + 1);

      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: {
          name: "Dashboard App",
          version: "1.0.0",
          icons: [
            {
              src: "https://example.com/icon.png",
              mimeType: "image/png",
              sizes: ["48x48", "16x16"],
            },
          ],
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent />);
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    const reRender = async () => {
      await act(async () => {
        triggerRender();
      });
      await flushMicrotasks();
    };

    for (let i = 0; i < 5; i++) {
      await reRender();
    }

    expect(addServerCalls.length).toBe(1);
    expect(sharedClient.closeSession).not.toHaveBeenCalled();
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not reconnect when clientInfo icon sizes order changes", async () => {
    function TestComponent({ sizes }: { sizes: string[] }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: {
          name: "Dashboard App",
          version: "1.0.0",
          icons: [
            {
              src: "https://example.com/icon.png",
              sizes,
            },
          ],
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent sizes={["16x16", "48x48"]} />);
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    // Update with sizes array in reversed order
    await act(async () => {
      root.update(<TestComponent sizes={["48x48", "16x16"]} />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);
    expect(sharedClient.closeSession).not.toHaveBeenCalled();
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects when clientInfo properties legitimately change", async () => {
    function TestComponent({ appName }: { appName: string }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: { name: appName, version: "1.0.0" },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent appName="AppV1" />);
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    // Change actual name
    await act(async () => {
      root.update(<TestComponent appName="AppV2" />);
    });
    await flushMicrotasks();

    // Now it should have disconnected and reconnected
    expect(addServerCalls.length).toBe(2);
    expect(addServerCalls[1].clientInfo.name).toBe("AppV2");
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects when clientInfo icons change", async () => {
    function TestComponent({ iconUrl }: { iconUrl: string }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: {
          name: "Dashboard App",
          version: "1.0.0",
          icons: [{ src: iconUrl }],
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(
        <TestComponent iconUrl="https://example.com/icon-v1.png" />
      );
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    await act(async () => {
      root.update(<TestComponent iconUrl="https://example.com/icon-v2.png" />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(addServerCalls[1].clientInfo.icons[0].src).toBe(
      "https://example.com/icon-v2.png"
    );
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
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
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    const reRender = async () => {
      await act(async () => {
        triggerRender();
      });
      await flushMicrotasks();
    };

    for (let i = 0; i < 5; i++) {
      await reRender();
    }

    expect(addServerCalls.length).toBe(1);
    expect(sharedClient.closeSession).not.toHaveBeenCalled();
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not reconnect when proxyConfig headers key order changes", async () => {
    function TestComponent({ headers }: { headers: Record<string, string> }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        proxyConfig: {
          proxyAddress: "https://gateway.example.com",
          headers,
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(
        <TestComponent headers={{ "x-first": "1", "x-second": "2" }} />
      );
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    // Update with keys in reversed order
    await act(async () => {
      root.update(
        <TestComponent headers={{ "x-second": "2", "x-first": "1" }} />
      );
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);
    expect(sharedClient.closeSession).not.toHaveBeenCalled();
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("does not reconnect when proxyConfig customHeaders key order changes", async () => {
    function TestComponent({
      customHeaders,
    }: {
      customHeaders: Record<string, string>;
    }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        proxyConfig: {
          proxyAddress: "https://gateway.example.com",
          customHeaders,
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(
        <TestComponent customHeaders={{ "x-first": "1", "x-second": "2" }} />
      );
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    // Update with keys in reversed order
    await act(async () => {
      root.update(
        <TestComponent customHeaders={{ "x-second": "2", "x-first": "1" }} />
      );
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);
    expect(sharedClient.closeSession).not.toHaveBeenCalled();
    expect(sharedClient.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects when proxyConfig proxyAddress changes", async () => {
    function TestComponent({ proxyUrl }: { proxyUrl: string }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        proxyConfig: { proxyAddress: proxyUrl },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent proxyUrl="https://gateway-1.example.com" />);
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    await act(async () => {
      root.update(<TestComponent proxyUrl="https://gateway-2.example.com" />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(addServerCalls[1].gatewayUrl).toBe("https://gateway-2.example.com");
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects when proxyConfig header value changes", async () => {
    function TestComponent({ apiKey }: { apiKey: string }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        proxyConfig: {
          proxyAddress: "https://gateway.example.com",
          headers: { "x-api-key": apiKey },
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent apiKey="key_v1" />);
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    await act(async () => {
      root.update(<TestComponent apiKey="key_v2" />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(addServerCalls[1].headers["x-api-key"]).toBe("key_v2");
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects when an icon changes from omitted sizes to explicit empty array", async () => {
    function TestComponent({ sizes }: { sizes?: string[] }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: {
          name: "Dashboard App",
          version: "1.0.0",
          icons: [{ src: "https://example.com/icon.png", sizes }],
        },
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(<TestComponent sizes={undefined} />);
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);

    await act(async () => {
      root.update(<TestComponent sizes={[]} />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(addServerCalls[1].clientInfo.icons[0].sizes).toEqual([]);
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects when clientInfo icons change from omitted to explicit empty array and restores default logo on reverse", async () => {
    function TestComponent({ icons }: { icons?: Array<{ src: string }> }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        clientInfo: {
          name: "Dashboard App",
          version: "1.0.0",
          ...(icons !== undefined ? { icons } : {}),
        },
      });

      return null;
    }

    let root: any;
    // Step 1: Omit icons -> receives default logo
    await act(async () => {
      root = create(<TestComponent icons={undefined} />);
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);
    expect(addServerCalls[0].clientInfo.icons).toEqual([
      { src: "https://mcp-use.com/logo.png" },
    ]);

    // Step 2: Set icons to explicit empty array [] -> reconnects with empty list
    await act(async () => {
      root.update(<TestComponent icons={[]} />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(addServerCalls[1].clientInfo.icons).toEqual([]);
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);

    // Step 3: Reverse back to omitted -> reconnects and restores default logo
    await act(async () => {
      root.update(<TestComponent icons={undefined} />);
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(3);
    expect(addServerCalls[2].clientInfo.icons).toEqual([
      { src: "https://mcp-use.com/logo.png" },
    ]);
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects when proxyConfig changes from legacy customHeaders to modern headers", async () => {
    function TestComponent({
      proxyConfig,
    }: {
      proxyConfig: {
        proxyAddress: string;
        headers?: Record<string, string>;
        customHeaders?: Record<string, string>;
      };
    }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        proxyConfig,
      });

      return null;
    }

    let root: any;
    await act(async () => {
      root = create(
        <TestComponent
          proxyConfig={{
            proxyAddress: "https://gateway.example.com",
            customHeaders: { "x-token": "123" },
          }}
        />
      );
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);
    // Preserving existing behavior: tokens in customHeaders alone are ignored by this hook
    expect(addServerCalls[0].headers?.["x-token"]).toBeUndefined();

    // Change to modern headers property with identical values
    await act(async () => {
      root.update(
        <TestComponent
          proxyConfig={{
            proxyAddress: "https://gateway.example.com",
            headers: { "x-token": "123" },
          }}
        />
      );
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(addServerCalls[1].headers["x-token"]).toBe("123");
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("reconnects and omits token when removing headers while retaining customHeaders", async () => {
    function TestComponent({
      proxyConfig,
    }: {
      proxyConfig: {
        proxyAddress: string;
        headers?: Record<string, string>;
        customHeaders?: Record<string, string>;
      };
    }) {
      useMcp({
        url: "http://localhost:3000/mcp",
        proxyConfig,
      });

      return null;
    }

    let root: any;
    // Start with the same token in both fields
    await act(async () => {
      root = create(
        <TestComponent
          proxyConfig={{
            proxyAddress: "https://gateway.example.com",
            headers: { "x-token": "123" },
            customHeaders: { "x-token": "123" },
          }}
        />
      );
    });
    mountedRoots.push(root);
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(1);
    expect(addServerCalls[0].headers["x-token"]).toBe("123");

    // Remove headers while retaining customHeaders
    await act(async () => {
      root.update(
        <TestComponent
          proxyConfig={{
            proxyAddress: "https://gateway.example.com",
            customHeaders: { "x-token": "123" },
          }}
        />
      );
    });
    await flushMicrotasks();

    expect(addServerCalls.length).toBe(2);
    expect(sharedClient.closeSession).toHaveBeenCalledTimes(1);
    // With existing request behavior preserved, the next connection omits that token
    expect(addServerCalls[1].headers?.["x-token"]).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });
});
