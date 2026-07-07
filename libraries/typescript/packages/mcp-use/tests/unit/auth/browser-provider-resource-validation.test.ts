// @vitest-environment jsdom

/**
 * Tests for `BrowserOAuthClientProvider.validateResourceURL` — the SDK
 * resource-validation hook (MCP-2678).
 *
 * When MCP traffic goes through a gateway/inspector proxy, the OAuth proxy
 * rewrites the protected-resource-metadata `resource` field to the connection
 * (proxy) URL. Manual auth runs validate against the REAL server URL, so the
 * SDK's strict check threw "Protected resource <proxy> does not match
 * expected <server> (or origin)" and the auth flow silently looped. The
 * provider hook must accept both anchors and return the real resource.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser-provider.js";

const SERVER_URL = "https://www.cubic.dev/api/mcp";
const CONNECTION_URL = "https://inspector.manufact.com/inspector/api/proxy";
const PROXY_URL = "https://inspector.manufact.com/inspector/api/oauth";

function makeProvider(options: Record<string, unknown> = {}) {
  return new BrowserOAuthClientProvider(SERVER_URL, {
    callbackUrl: "https://app.example.com/oauth/callback",
    ...options,
  });
}

describe("BrowserOAuthClientProvider.validateResourceURL", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns undefined when metadata has no resource (mirrors SDK)", async () => {
    const provider = makeProvider();
    await expect(
      provider.validateResourceURL(SERVER_URL, undefined)
    ).resolves.toBeUndefined();
  });

  it("returns the resource when it matches the requested server URL exactly", async () => {
    const provider = makeProvider();
    const result = await provider.validateResourceURL(SERVER_URL, SERVER_URL);
    expect(result?.toString()).toBe(SERVER_URL);
  });

  it("returns the resource when it is a path prefix of the requested server URL", async () => {
    const provider = makeProvider();
    const result = await provider.validateResourceURL(
      SERVER_URL,
      "https://www.cubic.dev/api"
    );
    expect(result?.toString()).toBe("https://www.cubic.dev/api");
  });

  it("accepts a resource rewritten to the connection URL and returns the server resource", async () => {
    // The OAuth proxy rewrote PRM `resource` -> connection URL. Validation
    // against the real server URL must still pass, and the resource used in
    // the authorization request must be the real one, not the proxy URL.
    const provider = makeProvider({ connectionUrl: CONNECTION_URL });
    const result = await provider.validateResourceURL(
      SERVER_URL,
      CONNECTION_URL
    );
    expect(result?.toString()).toBe(SERVER_URL);
  });

  it("handles root-path server URLs in the rewrite case (e.g. predictleads)", async () => {
    const rootServerUrl = "https://mcp.predictleads.com/";
    const provider = new BrowserOAuthClientProvider(rootServerUrl, {
      callbackUrl: "https://app.example.com/oauth/callback",
      connectionUrl: CONNECTION_URL,
    });
    const result = await provider.validateResourceURL(
      rootServerUrl,
      CONNECTION_URL
    );
    expect(result?.toString()).toBe(rootServerUrl);
  });

  it("prefers the cached _original_resource from proxied metadata over serverUrl", async () => {
    const provider = makeProvider({
      connectionUrl: CONNECTION_URL,
      oauthProxyUrl: PROXY_URL,
    });

    // Populate the provider's original-resource cache the way it happens in
    // production: a PRM fetch through the scoped proxy fetch whose response
    // carries `_original_resource` (stashed by the OAuth proxy on rewrite).
    const originalResource = "https://www.cubic.dev/api/mcp/scoped";
    const baseFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            resource: CONNECTION_URL,
            authorization_servers: ["https://as.example.com"],
            _original_resource: originalResource,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    ) as unknown as typeof fetch;
    const scoped = provider.getProxyFetch(baseFetch)!;
    await scoped(
      "https://www.cubic.dev/.well-known/oauth-protected-resource/api/mcp"
    );

    const result = await provider.validateResourceURL(
      SERVER_URL,
      CONNECTION_URL
    );
    expect(result?.toString()).toBe(originalResource);
  });

  it("throws the SDK-style mismatch error for a genuinely foreign resource", async () => {
    const provider = makeProvider({ connectionUrl: CONNECTION_URL });
    await expect(
      provider.validateResourceURL(SERVER_URL, "https://evil.example.com/mcp")
    ).rejects.toThrow(
      "Protected resource https://evil.example.com/mcp does not match expected https://www.cubic.dev/api/mcp (or origin)"
    );
  });

  it("throws on connection-URL resource when no connectionUrl is configured (direct)", async () => {
    const provider = makeProvider();
    await expect(
      provider.validateResourceURL(SERVER_URL, CONNECTION_URL)
    ).rejects.toThrow(/does not match expected/);
  });
});
