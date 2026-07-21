// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import type { UseMcpOptions } from "../../../src/react/types.js";

const initialize = vi.fn();
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
};

function connectionFor(protocolEra: "legacy" | "modern") {
  const protocolVersion =
    protocolEra === "legacy" ? "2025-06-18" : "2026-07-28";
  return {
    initialize,
    tools: [{ name: "echo", inputSchema: { type: "object" } }],
    info: {
      protocolEra,
      protocolVersion,
      server: {
        name: "uniform-server",
        version: "2.0.0",
        description: "same shape",
      },
      capabilities: {
        tools: {},
        extensions: { "example.dev/feature": { enabled: true } },
      },
      instructions: "Use uniformly",
      extensions: { "example.dev/feature": { enabled: true } },
    },
    supports: vi.fn().mockReturnValue(false),
    listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
  };
}

async function renderFor(
  protocolEra: "legacy" | "modern",
  views = false,
  options: Partial<UseMcpOptions> = {}
) {
  const connection = connectionFor(protocolEra);
  connect.mockResolvedValue(connection);
  let result:
    | ReturnType<typeof import("../../../src/react/useMcp.js").useMcp>
    | undefined;
  const { useMcp } = await import("../../../src/react/useMcp.js");

  function TestComponent() {
    result = useMcp({
      url: "https://example.com/mcp",
      authProvider,
      autoProxyFallback: false,
      autoReconnect: false,
      logLevel: "silent",
      ...(views && {
        clientOptions: { capabilities: { views: true } },
      }),
      ...options,
    });
    return null;
  }

  await act(async () => {
    create(<TestComponent />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return { result: result!, connection };
}

describe("useMcp connection metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["legacy", "modern"] as const)(
    "exposes normalized %s metadata without re-initializing",
    async (protocolEra) => {
      const { result } = await renderFor(protocolEra);

      expect(result.state).toBe("ready");
      expect(result.serverInfo).toMatchObject({
        name: "uniform-server",
        description: "same shape",
      });
      expect(result.capabilities).toEqual({
        tools: {},
        extensions: { "example.dev/feature": { enabled: true } },
      });
      expect(result.instructions).toBe("Use uniformly");
      expect(result.extensions).toEqual({
        "example.dev/feature": { enabled: true },
      });
      expect(result.protocolEra).toBe(protocolEra);
      expect(result.protocolVersion).toBe(
        protocolEra === "legacy" ? "2025-06-18" : "2026-07-28"
      );
      expect(connect).toHaveBeenCalledWith("inspector-server");
      expect(initialize).not.toHaveBeenCalled();
    }
  );

  it("advertises MCP Apps capabilities through capabilities.views", async () => {
    await renderFor("modern", true);

    expect(client.addServer).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        clientOptions: {
          capabilities: {
            extensions: {
              "io.modelcontextprotocol/ui": {
                mimeTypes: ["text/html;profile=mcp-app"],
              },
            },
          },
        },
      })
    );
  });

  it("exposes the discovered OAuth resource with auth tokens", async () => {
    authProvider.tokens.mockResolvedValue({
      access_token: "access-token",
      token_type: "Bearer",
      refresh_token: "refresh-token",
    });
    authProvider.getResource = vi
      .fn()
      .mockResolvedValue("https://mcp.example.com");

    const { result } = await renderFor("modern");

    expect(result.authTokens).toMatchObject({
      access_token: "access-token",
      resource: "https://mcp.example.com",
    });
  });

  it.each(["auto", "direct"] as const)(
    "starts %s mode without the configured proxy gateway",
    async (connectionMode) => {
      const proxyAddress = "https://inspector.example.com/api/proxy";

      await renderFor("modern", false, {
        connectionMode,
        proxyConfig: { proxyAddress },
        autoProxyFallback: { enabled: true, proxyAddress },
      });

      expect(client.addServer).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({ gatewayUrl: expect.anything() })
      );
    }
  );

  it("starts proxy mode on the configured proxy gateway", async () => {
    const proxyAddress = "https://inspector.example.com/api/proxy";

    await renderFor("modern", false, {
      connectionMode: "proxy",
      proxyConfig: { proxyAddress },
      autoProxyFallback: { enabled: true, proxyAddress },
    });

    expect(client.addServer).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ gatewayUrl: proxyAddress })
    );
  });

  it("falls back from a direct Auto attempt to the proxy gateway", async () => {
    vi.useFakeTimers();
    const proxyAddress = "https://inspector.example.com/api/proxy";
    const proxyConfig = { proxyAddress };
    const autoProxyFallback = { enabled: true, proxyAddress };
    const connection = connectionFor("modern");
    connect
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(connection);

    const { useMcp } = await import("../../../src/react/useMcp.js");
    let renderer: ReturnType<typeof create> | undefined;

    function TestComponent() {
      useMcp({
        url: "https://example.com/mcp",
        authProvider,
        connectionMode: "auto",
        proxyConfig,
        autoProxyFallback,
        autoReconnect: false,
        logLevel: "silent",
      });
      return null;
    }

    try {
      await act(async () => {
        renderer = create(<TestComponent />);
        await Promise.resolve();
      });

      expect(client.addServer).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.not.objectContaining({ gatewayUrl: expect.anything() })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(client.addServer).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ gatewayUrl: proxyAddress })
      );
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      vi.useRealTimers();
    }
  });
});
