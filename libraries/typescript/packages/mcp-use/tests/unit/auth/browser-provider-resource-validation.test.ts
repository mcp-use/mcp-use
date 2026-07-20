// @vitest-environment jsdom

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

describe("BrowserOAuthClientProvider.validateResourceURL", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("omits the resource when discovery does not provide one", async () => {
    const provider = makeProvider();
    await expect(
      provider.validateResourceURL(SERVER_URL, undefined)
    ).resolves.toBeUndefined();
  });

  it("returns a resource allowed for the requested server URL", async () => {
    const provider = makeProvider();
    const result = await provider.validateResourceURL(
      SERVER_URL,
      "https://www.cubic.dev/api"
    );

    expect(result?.toString()).toBe("https://www.cubic.dev/api");
  });

  it("accepts a connection URL rewrite and returns the upstream server resource", async () => {
    const provider = makeProvider({ connectionUrl: CONNECTION_URL });
    const result = await provider.validateResourceURL(
      SERVER_URL,
      CONNECTION_URL
    );

    expect(result?.toString()).toBe(SERVER_URL);
  });

  it("handles a root-path upstream server resource", async () => {
    const serverUrl = "https://mcp.predictleads.com/";
    const provider = new BrowserOAuthClientProvider(serverUrl, {
      callbackUrl: "https://app.example.com/oauth/callback",
      connectionUrl: CONNECTION_URL,
    });

    const result = await provider.validateResourceURL(
      serverUrl,
      CONNECTION_URL
    );
    expect(result?.toString()).toBe(serverUrl);
  });

  it("returns a validated original resource captured from proxied metadata", async () => {
    const provider = makeProvider({
      connectionUrl: CONNECTION_URL,
      oauthProxyUrl: PROXY_URL,
    });
    const baseFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            resource: CONNECTION_URL,
            authorization_servers: ["https://as.example.com"],
            _original_resource: "https://www.cubic.dev/api",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    ) as unknown as typeof fetch;

    await provider.getProxyFetch(baseFetch)!(
      "https://www.cubic.dev/.well-known/oauth-protected-resource/api/mcp"
    );

    const result = await provider.validateResourceURL(
      SERVER_URL,
      CONNECTION_URL
    );
    expect(result?.toString()).toBe("https://www.cubic.dev/api");
  });

  it("rejects an untrusted original resource returned by the proxy", async () => {
    const provider = makeProvider({
      connectionUrl: CONNECTION_URL,
      oauthProxyUrl: PROXY_URL,
    });
    const baseFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            resource: CONNECTION_URL,
            authorization_servers: ["https://as.example.com"],
            _original_resource: "https://evil.example.com/mcp",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    ) as unknown as typeof fetch;

    await provider.getProxyFetch(baseFetch)!(
      "https://www.cubic.dev/.well-known/oauth-protected-resource/api/mcp"
    );

    await expect(
      provider.validateResourceURL(SERVER_URL, CONNECTION_URL)
    ).rejects.toThrow(/does not match expected/);
  });

  it("rejects a genuinely foreign discovered resource", async () => {
    const provider = makeProvider({ connectionUrl: CONNECTION_URL });

    await expect(
      provider.validateResourceURL(SERVER_URL, "https://evil.example.com/mcp")
    ).rejects.toThrow(/does not match expected/);
  });
});
