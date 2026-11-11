// @vitest-environment jsdom

/**
 * HttpConnector composes a browser OAuth provider's scoped fetch, so OAuth
 * traffic follows `oauthProxyUrl` for every client that builds a connector
 * (BrowserMCPClient, useMcp, MCPClient). Related issue: #2729.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser.js";
import { HttpConnector } from "../../../src/transport/http.js";
import { installMemoryLocalStorage } from "../../helpers/memory-local-storage.js";

const MCP_URL = "https://mcp.example.com/mcp";
const METADATA_URL =
  "https://mcp.example.com/.well-known/oauth-protected-resource/mcp";
const OAUTH_PROXY_URL = "https://app.example.com/api/mcp-oauth";

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function recordingFetch() {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(requestUrl(input));
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { urls, fetchFn };
}

function connectorFetch(connector: HttpConnector): typeof fetch {
  return (connector as unknown as { customFetch: typeof fetch }).customFetch;
}

describe("HttpConnector OAuth proxy fetch", () => {
  let restoreLocalStorage: () => void;

  beforeEach(() => {
    restoreLocalStorage = installMemoryLocalStorage();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    restoreLocalStorage();
  });

  function browserProvider() {
    return new BrowserOAuthClientProvider(MCP_URL, {
      oauthProxyUrl: OAUTH_PROXY_URL,
    });
  }

  it("routes OAuth discovery through the provider's oauthProxyUrl", async () => {
    const { urls, fetchFn } = recordingFetch();
    const connector = new HttpConnector(MCP_URL, {
      fetch: fetchFn,
      authProvider: browserProvider(),
    });

    await connectorFetch(connector)(METADATA_URL);

    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith(`${OAUTH_PROXY_URL}/metadata?`)).toBe(true);
  });

  it("keeps MCP transport requests on the configured fetch", async () => {
    const { urls, fetchFn } = recordingFetch();
    const connector = new HttpConnector(MCP_URL, {
      fetch: fetchFn,
      authProvider: browserProvider(),
    });

    await connectorFetch(connector)(MCP_URL, { method: "POST", body: "{}" });

    expect(urls).toEqual([MCP_URL]);
  });

  it("applies the OAuth proxy inside the MCP gateway wrapper", async () => {
    const gatewayUrl = "https://inspector.example.com/inspector/api/proxy";
    const { urls, fetchFn } = recordingFetch();
    const connector = new HttpConnector(MCP_URL, {
      fetch: fetchFn,
      gatewayUrl,
      authProvider: browserProvider(),
    });

    await connectorFetch(connector)(METADATA_URL);
    await connectorFetch(connector)(MCP_URL, { method: "POST", body: "{}" });

    expect(urls[0].startsWith(`${OAUTH_PROXY_URL}/metadata?`)).toBe(true);
    expect(urls[1]).toBe(gatewayUrl);
  });

  it("uses the global fetch as the base when none is configured", async () => {
    const originalFetch = globalThis.fetch;
    const { urls, fetchFn } = recordingFetch();
    globalThis.fetch = fetchFn;
    try {
      const connector = new HttpConnector(MCP_URL, {
        authProvider: browserProvider(),
      });
      await connectorFetch(connector)(METADATA_URL);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(urls[0].startsWith(`${OAUTH_PROXY_URL}/metadata?`)).toBe(true);
  });
});
