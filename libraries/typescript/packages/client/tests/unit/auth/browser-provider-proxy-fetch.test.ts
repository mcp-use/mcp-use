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
import { BrowserOAuthClientProvider } from "../../../src/auth/browser.js";
import { installMemoryLocalStorage } from "../../helpers/memory-local-storage.js";

const PROXY_URL = "https://inspector.local/inspector/api/oauth";

describe("BrowserOAuthClientProvider — scoped OAuth proxy fetch", () => {
  let globalFetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;
  let restoreLocalStorage: () => void;

  beforeEach(() => {
    restoreLocalStorage = installMemoryLocalStorage();
    localStorage.clear();
    originalFetch = globalThis.fetch;
    globalFetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = globalFetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    restoreLocalStorage();
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

  it("drops incompatible legacy discovery after a fresh resource_metadata challenge", async () => {
    const resourceMetadataUrl =
      "https://server-a.example.com/.well-known/oauth-protected-resource/mcp";
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    await provider.saveDiscoveryState({
      authorizationServerUrl: "https://server-a.example.com",
      // Older discovery saved the challenge URL even when fetching or parsing
      // the protected-resource document failed, leaving resourceMetadata empty.
      resourceMetadataUrl,
      authorizationServerMetadata: {
        issuer: "https://server-a.example.com",
        authorization_endpoint: "https://server-a.example.com/authorize",
        token_endpoint: "https://server-a.example.com/token",
        response_types_supported: ["code"],
      },
    });
    await provider.saveClientInformation({ client_id: "legacy-client" });
    await provider.saveTokens({
      access_token: "existing-token",
      token_type: "Bearer",
    });
    globalFetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
        },
      })
    );

    await provider.getProxyFetch()!("https://server-a.example.com/mcp");

    expect(await provider.discoveryState()).toBeUndefined();
    expect(await provider.clientInformation()).toMatchObject({
      client_id: "legacy-client",
    });
    expect(await provider.tokens()).toMatchObject({
      access_token: "existing-token",
    });
  });

  it("drops complete discovery after a fresh challenge at the same metadata URL", async () => {
    const resourceMetadataUrl =
      "https://server-a.example.com/.well-known/oauth-protected-resource/mcp";
    const staleDiscovery = {
      authorizationServerUrl: "https://server-a.example.com",
      resourceMetadataUrl,
      resourceMetadata: {
        resource: "https://server-a.example.com/mcp",
        authorization_servers: ["https://server-a.example.com"],
      },
      authorizationServerMetadata: {
        issuer: "https://server-a.example.com",
        authorization_endpoint: "https://server-a.example.com/authorize",
        token_endpoint: "https://server-a.example.com/token",
        registration_endpoint: "https://server-a.example.com/register",
        response_types_supported: ["code"],
      },
    };
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    await provider.saveDiscoveryState(staleDiscovery);
    await provider.saveClientInformation({ client_id: "existing-client" });
    await provider.saveTokens({
      access_token: "existing-token",
      token_type: "Bearer",
    });
    globalFetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
        },
      })
    );

    await provider.getProxyFetch()!("https://server-a.example.com/mcp");

    expect(await provider.discoveryState()).toBeUndefined();
    expect(await provider.clientInformation()).toMatchObject({
      client_id: "existing-client",
    });
    expect(await provider.tokens()).toMatchObject({
      access_token: "existing-token",
    });

    const refreshedDiscovery = {
      ...staleDiscovery,
      authorizationServerUrl: "https://server-a.example.com/api/auth",
      resourceMetadata: {
        ...staleDiscovery.resourceMetadata,
        authorization_servers: ["https://server-a.example.com/api/auth"],
      },
      authorizationServerMetadata: {
        ...staleDiscovery.authorizationServerMetadata,
        issuer: "https://server-a.example.com/api/auth",
        authorization_endpoint:
          "https://server-a.example.com/api/auth/oauth2/authorize",
        token_endpoint: "https://server-a.example.com/api/auth/oauth2/token",
        registration_endpoint:
          "https://server-a.example.com/api/auth/oauth2/register",
      },
    };
    await provider.saveDiscoveryState(refreshedDiscovery);

    // The challenge is consumed once; freshly persisted discovery is reusable.
    expect(await provider.discoveryState()).toEqual(refreshedDiscovery);
  });

  it("stops proxying endpoints restored from discovery after a fresh challenge", async () => {
    const resourceMetadataUrl =
      "https://server-a.example.com/.well-known/oauth-protected-resource/mcp";
    const staleRegistrationEndpoint =
      "https://server-a.example.com/clients/legacy-enroll";
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    await provider.saveDiscoveryState({
      authorizationServerUrl: "https://server-a.example.com",
      resourceMetadataUrl,
      resourceMetadata: {
        resource: "https://server-a.example.com/mcp",
        authorization_servers: ["https://server-a.example.com"],
      },
      authorizationServerMetadata: {
        issuer: "https://server-a.example.com",
        authorization_endpoint: "https://server-a.example.com/authorize",
        token_endpoint: "https://server-a.example.com/token",
        registration_endpoint: staleRegistrationEndpoint,
        response_types_supported: ["code"],
      },
    });
    globalFetchSpy
      .mockResolvedValueOnce(
        new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
          },
        })
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const scoped = provider.getProxyFetch()!;

    await scoped("https://server-a.example.com/mcp");
    await scoped(staleRegistrationEndpoint, { method: "POST" });

    expect(String(globalFetchSpy.mock.calls[1][0])).toBe(
      staleRegistrationEndpoint
    );
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
    expect(new URL(proxiedUrl).searchParams.get("mcp_url")).toBeNull();
    expect(new URL(proxiedUrl).searchParams.get("serverUrl")).toBe(
      "https://server-a.example.com/mcp"
    );
    expect(globalFetchSpy.mock.calls[1][1]).toMatchObject({
      cache: "no-store",
      method: "GET",
    });
  });

  it("does not intercept browser authorization requests", async () => {
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    const scoped = provider.getProxyFetch()!;

    await scoped("https://auth.example.com/oauth/authorize");

    expect(globalFetchSpy).toHaveBeenCalledOnce();
    expect(String(globalFetchSpy.mock.calls[0][0])).toBe(
      "https://auth.example.com/oauth/authorize"
    );
  });

  it("proxies metadata-discovered OAuth endpoints with nonstandard paths", async () => {
    globalFetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token_endpoint: "https://auth.example.com/exchange",
          }),
          { headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
            body: { access_token: "token" },
          })
        )
      );
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    const scoped = provider.getProxyFetch()!;

    await scoped(
      "https://server-a.example.com/.well-known/oauth-authorization-server"
    );
    await scoped("https://auth.example.com/exchange", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code" }),
    });

    const proxyEndpoint = new URL(String(globalFetchSpy.mock.calls[1][0]));
    expect(`${proxyEndpoint.origin}${proxyEndpoint.pathname}`).toBe(
      `${PROXY_URL}/proxy`
    );
    expect(proxyEndpoint.searchParams.get("serverUrl")).toBe(
      "https://server-a.example.com/mcp"
    );
    expect(
      JSON.parse(String(globalFetchSpy.mock.calls[1][1]?.body)).serverUrl
    ).toBe("https://server-a.example.com/mcp");
  });

  it("preserves OAuth method, headers, and body from a Request object", async () => {
    globalFetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            registration_endpoint: "https://auth.example.com/register",
          }),
          { headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 201,
            statusText: "Created",
            headers: { "content-type": "application/json" },
            body: { client_id: "registered-client" },
          })
        )
      );
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    const scoped = provider.getProxyFetch()!;

    await scoped(
      "https://server-a.example.com/.well-known/oauth-authorization-server"
    );
    const registrationBody = JSON.stringify({
      client_name: "Inspector",
      redirect_uris: ["https://app.example.com/oauth/callback"],
    });
    await scoped(
      new Request("https://auth.example.com/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: registrationBody,
      })
    );

    const payload = JSON.parse(String(globalFetchSpy.mock.calls[1][1]?.body));
    expect(payload).toMatchObject({
      serverUrl: "https://server-a.example.com/mcp",
      url: "https://auth.example.com/register",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: registrationBody,
    });
  });

  it("restores nonstandard OAuth endpoints from persisted discovery state after callback reconstruction", async () => {
    globalFetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          body: { access_token: "token" },
        })
      )
    );
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    await provider.saveDiscoveryState({
      authorizationServerUrl: "https://auth.example.com",
      authorizationServerMetadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/exchange",
        response_types_supported: ["code"],
      },
    });

    await provider.getProxyFetch()!("https://auth.example.com/exchange", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code" }),
    });

    const proxyEndpoint = new URL(String(globalFetchSpy.mock.calls[0][0]));
    expect(`${proxyEndpoint.origin}${proxyEndpoint.pathname}`).toBe(
      `${PROXY_URL}/proxy`
    );
    expect(proxyEndpoint.searchParams.get("serverUrl")).toBe(
      "https://server-a.example.com/mcp"
    );
  });

  it("fails closed when the OAuth proxy request fails", async () => {
    const proxyError = new Error("proxy unavailable");
    globalFetchSpy.mockRejectedValueOnce(proxyError);
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });
    const scoped = provider.getProxyFetch()!;

    await expect(
      scoped("https://auth.example.com/oauth/token", { method: "POST" })
    ).rejects.toBe(proxyError);
    expect(globalFetchSpy).toHaveBeenCalledOnce();
  });

  it("preserves an OAuth BFF error response instead of returning an empty body", async () => {
    globalFetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "application/json" },
      })
    );
    const provider = makeProvider({ oauthProxyUrl: PROXY_URL });

    const response = await provider.getProxyFetch()!(
      "https://auth.example.com/oauth/token",
      { method: "POST" }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origin not allowed" });
  });

  it("Server B (Direct) bypasses metadata cache and never proxies — even while Server A uses a proxy", async () => {
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

    // Server B gets its own scoped wrapper, but still uses its direct base
    // fetch rather than Server A's proxy.
    const baseFetchB = vi.fn(
      async () => new Response("{}", { status: 200 })
    ) as unknown as typeof fetch;
    const fetchB = serverB.getProxyFetch(baseFetchB);
    expect(fetchB).not.toBe(baseFetchB);

    // An OAuth-shaped request through Server B's fetch must go DIRECT, not via
    // Server A's proxy.
    await fetchB!(
      "https://server-b.example.com/.well-known/oauth-authorization-server"
    );
    expect(baseFetchB).toHaveBeenCalledTimes(1);
    expect(String((baseFetchB as any).mock.calls[0][0])).toBe(
      "https://server-b.example.com/.well-known/oauth-authorization-server"
    );
    expect((baseFetchB as any).mock.calls[0][1]).toMatchObject({
      cache: "no-store",
    });
    // The global fetch was never used for Server B's request.
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  it("bypasses metadata cache when proxyOAuthRequests is disabled", async () => {
    const provider = makeProvider({
      oauthProxyUrl: PROXY_URL,
      proxyOAuthRequests: false,
    });

    const base = vi.fn(
      async () => new Response("{}", { status: 200 })
    ) as unknown as typeof fetch;
    const scoped = provider.getProxyFetch(base)!;

    await scoped("https://auth.example.com/.well-known/openid-configuration");

    expect(String((base as any).mock.calls[0][0])).toBe(
      "https://auth.example.com/.well-known/openid-configuration"
    );
    expect((base as any).mock.calls[0][1]).toMatchObject({
      cache: "no-store",
    });
  });

  it("uses global fetch with no-store metadata when no base or proxy is configured", async () => {
    const provider = makeProvider();
    const scoped = provider.getProxyFetch()!;

    await scoped(
      "https://auth.example.com/.well-known/oauth-authorization-server"
    );

    expect(globalFetchSpy).toHaveBeenCalledOnce();
    expect(globalFetchSpy.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
    });
  });

  it("does not change cache behavior for direct non-metadata requests", async () => {
    const provider = makeProvider();
    const base = vi.fn(
      async () => new Response("{}", { status: 200 })
    ) as unknown as typeof fetch;
    const scoped = provider.getProxyFetch(base)!;
    const init = { headers: { "X-Test": "value" } };

    await scoped("https://server-a.example.com/mcp", init);

    expect(base).toHaveBeenCalledWith("https://server-a.example.com/mcp", init);
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

  describe("re-anchoring proxy-origin .well-known discovery onto the MCP server", () => {
    // MCP traffic tunneled through a gateway proxy: the SDK transport derives
    // .well-known URLs from the proxy URL whenever no resource_metadata hint is
    // available (SSE EventSource can't read WWW-Authenticate; token refresh has
    // no 401 response). Those must be re-anchored onto the real server or
    // discovery lands on the proxy origin and fails.
    const CONNECTION_URL = "https://inspector.local/inspector/api/proxy";

    function makeProxiedProvider() {
      return makeProvider({
        oauthProxyUrl: PROXY_URL,
        connectionUrl: CONNECTION_URL,
      });
    }

    function proxiedMetadataTarget(callIndex: number): string {
      const proxied = new URL(String(globalFetchSpy.mock.calls[callIndex][0]));
      return proxied.searchParams.get("url")!;
    }

    it("rewrites the path-insertion PRM lookup to the server origin + path", async () => {
      const scoped = makeProxiedProvider().getProxyFetch()!;

      await scoped(
        "https://inspector.local/.well-known/oauth-protected-resource/inspector/api/proxy"
      );

      expect(proxiedMetadataTarget(0)).toBe(
        "https://server-a.example.com/.well-known/oauth-protected-resource/mcp"
      );
    });

    it("rewrites the root-form AS metadata lookup to the server origin", async () => {
      const scoped = makeProxiedProvider().getProxyFetch()!;

      await scoped(
        "https://inspector.local/.well-known/oauth-authorization-server"
      );

      expect(proxiedMetadataTarget(0)).toBe(
        "https://server-a.example.com/.well-known/oauth-authorization-server"
      );
    });

    it("fetches re-anchored metadata directly when OAuth proxying is disabled", async () => {
      const base = vi.fn(
        async () => new Response("{}", { status: 200 })
      ) as unknown as typeof fetch;
      const scoped = makeProvider({
        connectionUrl: CONNECTION_URL,
      }).getProxyFetch(base)!;

      await scoped(
        "https://inspector.local/.well-known/oauth-protected-resource/inspector/api/proxy"
      );

      expect(base).toHaveBeenCalledWith(
        "https://server-a.example.com/.well-known/oauth-protected-resource/mcp",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    it("leaves .well-known lookups on unrelated origins untouched", async () => {
      const scoped = makeProxiedProvider().getProxyFetch()!;

      await scoped(
        "https://idp.example.org/.well-known/oauth-authorization-server"
      );

      expect(proxiedMetadataTarget(0)).toBe(
        "https://idp.example.org/.well-known/oauth-authorization-server"
      );
    });

    it("does not rewrite anything when no connectionUrl is configured (direct)", async () => {
      const scoped = makeProvider({
        oauthProxyUrl: PROXY_URL,
      }).getProxyFetch()!;

      await scoped(
        "https://server-a.example.com/.well-known/oauth-protected-resource/mcp"
      );

      expect(proxiedMetadataTarget(0)).toBe(
        "https://server-a.example.com/.well-known/oauth-protected-resource/mcp"
      );
    });
  });
});
