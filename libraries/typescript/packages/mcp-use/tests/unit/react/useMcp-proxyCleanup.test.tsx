// @vitest-environment jsdom

/**
 * Tests that useMcp calls restoreFetch() on unmount to tear down any
 * window.fetch interceptor installed by a proxy-mode OAuth provider.
 *
 * Related issue: MCP-1713 — Inspector: switching from "Via Proxy" → "Direct"
 * fails with "Protected resource does not match" error because the stale
 * interceptor from the proxy connection is never removed.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

vi.mock("../../../src/client/browser.js", () => ({
  // Use a regular function (not arrow) so it's constructable with `new`
  BrowserMCPClient: vi.fn(function () {
    return {
      addServer: vi.fn().mockResolvedValue(undefined),
      removeServer: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockReturnValue(null),
      createSession: vi.fn().mockResolvedValue(undefined),
      listSessions: vi.fn().mockReturnValue([]),
    };
  }),
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
    }),
  },
}));

describe("useMcp proxy connection cleanup", () => {
  let useMcp: any;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import("../../../src/react/useMcp.js");
    useMcp = module.useMcp;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls restoreFetch() on the auth provider when the hook unmounts", async () => {
    const restoreFetch = vi.fn();
    const mockAuthProvider = {
      restoreFetch,
      clearStorage: vi.fn().mockReturnValue(0),
      serverUrl: "http://localhost:3001/mcp",
    };

    let renderer: ReturnType<typeof create>;

    function TestComponent() {
      useMcp({
        url: "http://localhost:3001/mcp",
        enabled: true,
        authProvider: mockAuthProvider,
      });
      return null;
    }

    await act(async () => {
      renderer = create(<TestComponent />);
    });

    expect(restoreFetch).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.unmount();
    });

    expect(restoreFetch).toHaveBeenCalledOnce();
  });

  it("does not throw on unmount when no auth provider is set", async () => {
    let renderer: ReturnType<typeof create>;

    function TestComponent() {
      useMcp({
        url: "http://localhost:3001/mcp",
        enabled: false, // skip connection so authProviderRef stays null
      });
      return null;
    }

    await act(async () => {
      renderer = create(<TestComponent />);
    });

    await expect(
      act(async () => {
        renderer!.unmount();
      })
    ).resolves.not.toThrow();
  });
});
