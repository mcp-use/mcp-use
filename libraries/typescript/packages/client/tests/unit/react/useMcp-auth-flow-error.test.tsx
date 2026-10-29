// @vitest-environment jsdom

import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "@modelcontextprotocol/client";

const mocks = vi.hoisted(() => {
  const auth = vi.fn();
  const runAuthPopup = vi.fn();
  const provider = {
    serverUrl: "https://mcp.example.com/mcp",
    serverUrlHash: "server-hash",
    clearStorage: vi.fn().mockReturnValue(0),
    getLastAttemptedAuthUrl: vi.fn().mockReturnValue(null),
    getProxyFetch: vi.fn().mockReturnValue(undefined),
    getKey: vi.fn((suffix: string) => `oauth:${suffix}`),
    tokens: vi.fn().mockResolvedValue(undefined),
  };
  const client = {
    addServer: vi.fn(),
    removeServer: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    getSession: vi.fn().mockReturnValue(null),
    closeSession: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockReturnValue([]),
  };
  const createBrowserOAuthProvider = vi.fn(() => ({
    provider,
    oauthProxyUrl: "https://inspector.example.com/oauth",
  }));

  return {
    auth,
    runAuthPopup,
    provider,
    client,
    createBrowserOAuthProvider,
  };
});

vi.mock("@modelcontextprotocol/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  auth: mocks.auth,
}));

vi.mock("../../../src/core/browser.js", () => ({
  BrowserMCPClient: vi.fn(function () {
    return mocks.client;
  }),
}));

vi.mock("../../../src/react/useMcp-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/react/useMcp-helpers.js")
  >()),
  createBrowserOAuthProvider: mocks.createBrowserOAuthProvider,
}));

vi.mock("../../../src/auth/popup.js", () => ({
  runAuthPopup: mocks.runAuthPopup,
  MCP_AUTH_BROADCAST_CHANNEL: "mcp_auth_callback",
  MCP_AUTH_CALLBACK_MESSAGE_TYPE: "mcp_auth_callback",
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

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } as Storage;
}

describe("useMcp manual authentication failures", () => {
  let useMcp: typeof import("../../../src/react/useMcp.js").useMcp;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", makeStorage());
    mocks.provider.getLastAttemptedAuthUrl.mockReturnValue(null);
    mocks.client.connect.mockRejectedValue(
      Object.assign(new Error("401 Unauthorized"), { code: 401 })
    );
    mocks.auth.mockRejectedValue(
      new Error("Protected resource metadata does not match the MCP server")
    );

    vi.resetModules();
    ({ useMcp } = await import("../../../src/react/useMcp.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("forwards generic pre-registered client credentials to the browser provider", async () => {
    function TestComponent() {
      useMcp({
        url: "https://mcp.example.com/mcp",
        oauthProxyUrl: "https://app.example.com/inspector/api/oauth",
        oauth: {
          clientId: "pre-registered-client",
          clientSecret: "confidential-secret",
          scope: "read write",
        },
        autoReconnect: false,
        autoRetry: false,
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createBrowserOAuthProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        staticClientInfo: {
          client_id: "pre-registered-client",
          client_secret: "confidential-secret",
        },
        scope: "read write",
      })
    );

    await act(async () => renderer!.unmount());
  });

  it("surfaces pre-redirect auth errors without starting the popup runner", async () => {
    let latest: ReturnType<typeof useMcp> | undefined;

    function TestComponent() {
      latest = useMcp({
        url: "https://mcp.example.com/mcp",
        autoProxyFallback: false,
        autoReconnect: false,
        autoRetry: false,
        logLevel: "silent",
      });
      return null;
    }

    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<TestComponent />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest?.state).toBe("pending_auth");

    await act(async () => {
      await latest!.authenticate();
    });

    expect(latest?.state).toBe("failed");
    expect(latest?.error).toContain("Protected resource metadata");
    expect(mocks.runAuthPopup).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.unmount();
    });
  });

  it.each(["cancelled", "timeout"] as const)(
    "keeps an optional mixed-auth connection ready when authentication is %s",
    async (kind) => {
      mocks.client.connect.mockResolvedValue({
        tools: [{ name: "public", inputSchema: { type: "object" } }],
        info: {
          protocolEra: "legacy",
          protocolVersion: "2025-06-18",
          server: { name: "mixed", version: "1.0.0" },
          capabilities: { tools: {} },
          instructions: undefined,
          extensions: {},
          authorization: { mode: "mixed", authenticated: false },
        },
        supports: vi.fn().mockReturnValue(false),
        listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
        listResourceTemplates: vi
          .fn()
          .mockResolvedValue({ resourceTemplates: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      });
      mocks.auth.mockResolvedValue("REDIRECT");
      mocks.provider.getLastAttemptedAuthUrl.mockReturnValue(
        "https://auth.example.com/authorize?state=prepared"
      );
      mocks.runAuthPopup.mockResolvedValue({ kind });

      let latest: ReturnType<typeof useMcp> | undefined;
      function TestComponent() {
        latest = useMcp({
          url: "https://mcp.example.com/mcp",
          autoProxyFallback: false,
          autoReconnect: false,
          autoRetry: false,
          logLevel: "silent",
        });
        return null;
      }

      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(<TestComponent />);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(latest?.state).toBe("ready");

      await act(async () => {
        await latest!.authenticate();
      });

      expect(mocks.runAuthPopup).toHaveBeenCalledOnce();
      expect(latest?.state).toBe("ready");
      expect(latest?.authorization).toEqual({
        mode: "mixed",
        authenticated: false,
      });

      await act(async () => {
        renderer!.unmount();
      });
    }
  );

  it.each([
    {
      operation: "resource",
      invoke: (result: ReturnType<typeof useMcp>) =>
        result.readResource("resource://private/profile"),
    },
    {
      operation: "prompt",
      invoke: (result: ReturnType<typeof useMcp>) =>
        result.getPrompt("private-profile"),
    },
  ])(
    "surfaces OAuth state when a protected $operation operation is challenged",
    async ({ invoke }) => {
      const authorizationError = new UnauthorizedError(
        "Authorization required"
      );
      mocks.provider.getLastAttemptedAuthUrl.mockReturnValue(
        "https://auth.example.com/authorize?state=prepared"
      );
      mocks.client.connect.mockResolvedValue({
        tools: [{ name: "public", inputSchema: { type: "object" } }],
        info: {
          protocolEra: "legacy",
          protocolVersion: "2025-06-18",
          server: { name: "mixed", version: "1.0.0" },
          capabilities: { tools: {} },
          instructions: undefined,
          extensions: {},
        },
        supports: vi.fn().mockReturnValue(false),
        listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
        listResourceTemplates: vi
          .fn()
          .mockResolvedValue({ resourceTemplates: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        readResource: vi.fn().mockRejectedValue(authorizationError),
        getPrompt: vi.fn().mockRejectedValue(authorizationError),
      });

      let latest: ReturnType<typeof useMcp> | undefined;
      function TestComponent() {
        latest = useMcp({
          url: "https://mcp.example.com/mcp",
          autoProxyFallback: false,
          autoReconnect: false,
          autoRetry: false,
          logLevel: "silent",
        });
        return null;
      }

      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(<TestComponent />);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(latest?.state).toBe("ready");

      await act(async () => {
        await expect(invoke(latest!)).rejects.toBe(authorizationError);
      });

      expect(latest?.state).toBe("ready");
      expect(latest?.authorization).toEqual({
        mode: "mixed",
        authenticated: false,
      });
      expect(latest?.authUrl).toBe(
        "https://auth.example.com/authorize?state=prepared"
      );

      await act(async () => {
        renderer!.unmount();
      });
    }
  );
});
