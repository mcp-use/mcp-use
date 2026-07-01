// @vitest-environment jsdom

/**
 * Tests that OAuth proxy behavior is scoped to the provider via
 * `getProxyFetch()` and never mutates the global `fetch`.
 *
 * Related issue: #1766 — Inspector: setting one server to "Via Proxy" must not
 * affect every fetch globally. Multiple servers should independently choose
 * "Via Proxy" or "Direct", and proxy behavior must be confined to the selected
 * server's connection rather than patching `window.fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser-provider.js";

const PROXY_URL = "https://inspector.local/inspector/api/oauth";

describe("BrowserOAuthClientProvider — scoped OAuth proxy fetch", () => {
  let globalFetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    originalFetch = globalThis.fetch;
    globalFetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = globalFetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.clearAllMocks();
  });

  function makeProvider(options: Record<string, unknown> = {}) {
    return new BrowserOAuthClientProvider("https://server-a.example.com/mcp", {
      callbackUrl: "https://app.example.com/oauth/callback",
      ...options,
    });
  }

  it("never reassigns the global fetch when building a scoped proxy fetch", () => {
    const fetchBefore = globalThis.fetch;
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });

    const scoped = provider.getProxyFetch();

    // The global fetch must be left untouched — the whole point of #1766.
    expect(globalThis.fetch).toBe(fetchBefore);
    // A distinct, scoped fetch is returned (not the global one).
    expect(scoped).toBeTypeOf("function");
    expect(scoped).not.toBe(globalThis.fetch);
  });

  it("routes OAuth metadata requests through the proxy without touching non-OAuth requests", async () => {
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    const scoped = provider.getProxyFetch()!;

    // Non-OAuth request: passes straight through to the base fetch, untouched.
    await scoped("https://server-a.example.com/mcp");
    expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    expect(String(globalFetchSpy.mock.calls[0][0])).toBe(
      "https://server-a.example.com/mcp"
    );

    // OAuth metadata request: rewritten to go through the OAuth proxy.
    await scoped(
      "https://server-a.example.com/.well-known/oauth-authorization-server"
    );
    expect(globalFetchSpy).toHaveBeenCalledTimes(2);
    const proxiedUrl = String(globalFetchSpy.mock.calls[1][0]);
    expect(proxiedUrl.startsWith(`${PROXY_URL}/metadata`)).toBe(true);
  });

  it("Server B (Direct) gets a plain fetch and never proxies — even while Server A uses a proxy", async () => {
    // Server A: "Via Proxy".
    const serverA = new BrowserOAuthClientProvider(
      "https://server-a.example.com/mcp",
      {
        callbackUrl: "https://app.example.com/oauth/callback",
        oauthProxyUrl: PROXY_URL,
      }
    );
    // Server B: "Direct" (no OAuth proxy configured).
    const serverB = new BrowserOAuthClientProvider(
      "https://server-b.example.com/mcp",
      { callbackUrl: "https://app.example.com/oauth/callback" }
    );

    // Building Server A's proxy fetch must not affect anything else.
    const fetchA = serverA.getProxyFetch();
    expect(fetchA).toBeTypeOf("function");

    // Server B returns the base fetch as-is (no scoping/proxy wrapper).
    const baseFetchB = vi.fn(
      async () => new Response("{}", { status: 200 })
    ) as unknown as typeof fetch;
    const fetchB = serverB.getProxyFetch(baseFetchB);
    expect(fetchB).toBe(baseFetchB);

    // An OAuth-shaped request through Server B's fetch must go DIRECT, not via
    // Server A's proxy.
    await fetchB!(
      "https://server-b.example.com/.well-known/oauth-authorization-server"
    );
    expect(baseFetchB).toHaveBeenCalledTimes(1);
    expect(String((baseFetchB as any).mock.calls[0][0])).toBe(
      "https://server-b.example.com/.well-known/oauth-authorization-server"
    );
    // The global fetch was never used for Server B's request.
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  it("returns the base fetch unchanged when proxyOAuthRequests is disabled", () => {
    const provider = makeProvider({
      oauthProxyUrl: PROXY_URL,
      proxyOAuthRequests: false,
    });

    const base = vi.fn() as unknown as typeof fetch;
    expect(provider.getProxyFetch(base)).toBe(base);
    expect(provider.getProxyFetch()).toBeUndefined();
  });

  it("returns the base fetch unchanged when no OAuth proxy URL is configured", () => {
    const provider = makeProvider();

    const base = vi.fn() as unknown as typeof fetch;
    expect(provider.getProxyFetch(base)).toBe(base);
    expect(provider.getProxyFetch()).toBeUndefined();
  });

  it("wraps a provided base fetch (e.g. scope step-up retry) for non-OAuth requests", async () => {
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    const customFetch = vi.fn(
      async () => new Response("{}", { status: 200 })
    ) as unknown as typeof fetch;

    const scoped = provider.getProxyFetch(customFetch)!;
    await scoped("https://server-a.example.com/mcp");

    // Non-OAuth request flows through the provided base fetch, not the global.
    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });
});
