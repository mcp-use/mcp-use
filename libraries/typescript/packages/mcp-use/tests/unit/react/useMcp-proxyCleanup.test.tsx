// @vitest-environment jsdom

/**
 * Tests that useMcp scopes OAuth proxy behavior to the connection instead of
 * mutating the global fetch.
 *
 * Originally tracked the MCP-1713 symptom (switching "Via Proxy" → "Direct"
 * failed because a stale global fetch interceptor was never torn down). That
 * class of bug — and the related #1766 (one "Via Proxy" server affecting every
 * fetch globally) — is now structurally impossible: the provider exposes a
 * scoped `getProxyFetch()` that is passed only to the SDK transport/auth, so
 * the global `fetch` is never reassigned and there is nothing to "restore" on
 * unmount.
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
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.resetModules();
    originalFetch = globalThis.fetch;
    const module = await import("../../../src/react/useMcp.js");
    useMcp = module.useMcp;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("never reassigns the global fetch across a proxy connection's mount/unmount", async () => {
    const fetchBefore = globalThis.fetch;

    // A proxy-mode auth provider exposes a scoped getProxyFetch(); the hook must
    // not install or tear down any global fetch interceptor.
    const getProxyFetch = vi.fn((base?: typeof fetch) => base);
    const mockAuthProvider = {
      getProxyFetch,
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

    expect(globalThis.fetch).toBe(fetchBefore);

    await act(async () => {
      renderer!.unmount();
    });

    // Global fetch identity is preserved — no global interceptor was installed.
    expect(globalThis.fetch).toBe(fetchBefore);
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
