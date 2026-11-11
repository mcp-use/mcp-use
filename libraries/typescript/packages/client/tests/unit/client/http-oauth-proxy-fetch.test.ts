// @vitest-environment jsdom

/**
 * HttpConnector composes a browser OAuth provider's scoped fetch, so OAuth
 * traffic follows `oauthProxyUrl` for every client that builds a connector
 * (BrowserMCPClient, useMcp, MCPClient). Related issue: #2729.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserOAuthClientProvider } from "../../../src/auth/browser.js";
import { BrowserMCPClient } from "../../../src/core/browser.js";
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

  it("routes 401-triggered discovery through oauthProxyUrl when creating a browser session", async () => {
    const authorizationServer = "https://auth.example.com";
    const authorizationMetadataUrl = `${authorizationServer}/.well-known/oauth-authorization-server`;
    const requests: string[] = [];
    const proxiedMetadata: string[] = [];
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    const fetchFn: typeof fetch = async (input) => {
      const url = requestUrl(input);
      requests.push(url);
      if (url === MCP_URL) {
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${METADATA_URL}"`,
          },
        });
      }
      if (url.startsWith(`${OAUTH_PROXY_URL}/metadata?`)) {
        const target = new URL(url).searchParams.get("url");
        if (target === METADATA_URL) {
          proxiedMetadata.push(target);
          return json({
            resource: MCP_URL,
            authorization_servers: [authorizationServer],
          });
        }
        if (target === authorizationMetadataUrl) {
          proxiedMetadata.push(target);
          return json({
            issuer: authorizationServer,
            authorization_endpoint: `${authorizationServer}/authorize`,
            token_endpoint: `${authorizationServer}/token`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
          });
        }
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const client = new BrowserMCPClient({
      mcpServers: {
        demo: {
          url: MCP_URL,
          fetch: fetchFn,
          protocolNegotiation: "legacy",
          oauth: {
            oauthProxyUrl: OAUTH_PROXY_URL,
            callbackUrl: "https://app.example.com/oauth/callback",
            staticClientInfo: { client_id: "browser-session-test" },
            preventAutoAuth: true,
          },
        },
      },
    });

    try {
      // Discovery must reach the expected sign-in boundary, without opening
      // a popup or accepting an unrelated discovery/fixture failure.
      await expect(client.createSession("demo")).rejects.toMatchObject({
        code: 401,
      });
      expect(proxiedMetadata).toEqual(
        expect.arrayContaining([METADATA_URL, authorizationMetadataUrl])
      );
      expect(requests).not.toContain(METADATA_URL);
      expect(requests).not.toContain(authorizationMetadataUrl);
    } finally {
      await client.closeAllSessions();
    }
  });

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
