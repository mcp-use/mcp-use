// @vitest-environment jsdom

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

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

vi.mock("../../../src/react/favicon.js", () => ({
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

async function renderFor(protocolEra: "legacy" | "modern", views = false) {
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
});
