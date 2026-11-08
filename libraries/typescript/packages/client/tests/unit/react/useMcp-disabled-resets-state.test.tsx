// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { UseMcpResult } from "../../../src/react/types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const connect = vi.fn();

const client = {
  addServer: vi.fn(),
  connect,
  getSession: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../src/core/browser.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  BrowserMCPClient: vi.fn(function () {
    return client;
  }),
}));

vi.mock("../../../src/telemetry/telemetry-browser.js", () => ({
  Tel: {
    getInstance: () => ({
      trackUseMcpConnection: vi.fn().mockResolvedValue(undefined),
      trackUseMcpToolCall: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../../src/utils/favicon.js", () => ({
  detectFavicon: vi.fn().mockResolvedValue(null),
}));

const authProvider = {
  serverUrl: "https://example.com/mcp",
  tokens: vi.fn().mockResolvedValue(undefined),
  clearStorage: vi.fn().mockReturnValue(0),
  getLastAttemptedAuthUrl: vi.fn().mockReturnValue(null),
};

function connectionWithData() {
  return {
    initialize: vi.fn(),
    tools: [{ name: "echo", inputSchema: { type: "object" } }],
    info: {
      protocolEra: "modern",
      protocolVersion: "2026-07-28",
      server: { name: "stale-server", version: "2.0.0" },
      capabilities: { tools: {} },
      instructions: "Use carefully",
      extensions: { "example.dev/feature": { enabled: true } },
    },
    supports: vi.fn().mockReturnValue(false),
    callTool: vi.fn().mockResolvedValue({ content: [] }),
    listAllResources: vi
      .fn()
      .mockResolvedValue({ resources: [{ uri: "mem://x", name: "r" }] }),
    listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
  };
}

describe("useMcp resets state when disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connect.mockResolvedValue(connectionWithData());
  });

  it("clears tools and serverInfo after enabled turns false", async () => {
    const { useMcp: useMcpHook } = await import("../../../src/react/useMcp.js");

    let result: UseMcpResult | undefined;

    function TestComponent({ enabled }: { enabled: boolean }) {
      result = useMcpHook({
        url: "https://example.com/mcp",
        authProvider,
        autoProxyFallback: false,
        autoReconnect: false,
        logLevel: "silent",
        enabled,
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<TestComponent enabled={true} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Connected: the server's data is present.
    expect(result!.state).toBe("ready");
    expect(result!.tools).toHaveLength(1);
    expect(result!.serverInfo).toBeDefined();

    // Disable the hook.
    await act(async () => {
      renderer!.update(<TestComponent enabled={false} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Disabled: no stale data from the previous server.
    expect(result!.state).toBe("discovering");
    expect(result!.tools).toEqual([]);
    expect(result!.resources).toEqual([]);
    expect(result!.resourceTemplates).toEqual([]);
    expect(result!.prompts).toEqual([]);
    expect(result!.serverInfo).toBeUndefined();
    expect(result!.capabilities).toBeUndefined();
    expect(result!.instructions).toBeUndefined();
  });
});
