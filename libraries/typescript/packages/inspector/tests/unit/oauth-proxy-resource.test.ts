import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountOAuthProxy } from "../../src/server/proxy/oauth-proxy";

const inspectorOrigin = "https://inspector.example.com";
const issuer = "https://93.184.216.35";

function protectedResourceMetadataUrl(serverUrl: string): string {
  const server = new URL(serverUrl);
  const path = server.pathname === "/" ? "" : server.pathname;
  return `${server.origin}/.well-known/oauth-protected-resource${path}`;
}

function rootProtectedResourceMetadataUrl(serverUrl: string): string {
  return `${new URL(serverUrl).origin}/.well-known/oauth-protected-resource`;
}

function metadataRequest(serverUrl: string, targetUrl: string): Request {
  return new Request(
    `${inspectorOrigin}/oauth/metadata?serverUrl=${encodeURIComponent(serverUrl)}&url=${encodeURIComponent(targetUrl)}`,
    { headers: { Origin: inspectorOrigin } }
  );
}

async function requestProtectedResourceMetadata(options: {
  serverUrl: string;
  metadataUrl?: string;
  advertisedResource: string;
  allowLoopback?: boolean;
}): Promise<Response> {
  const metadataUrl =
    options.metadataUrl ?? protectedResourceMetadataUrl(options.serverUrl);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      if (input.toString() === metadataUrl) {
        return new Response(
          JSON.stringify({
            resource: options.advertisedResource,
            authorization_servers: [issuer],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return new Response("not found", { status: 404 });
    })
  );

  const app = new Hono();
  mountOAuthProxy(app, {
    basePath: "/oauth",
    enableLogging: false,
    allowLoopback: options.allowLoopback,
  });
  return app.fetch(metadataRequest(options.serverUrl, metadataUrl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Inspector OAuth BFF protected-resource binding", () => {
  it("accepts metadata exactly bound to a path-scoped MCP endpoint", async () => {
    const serverUrl = "https://93.184.216.34/api/mcp";

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      advertisedResource: serverUrl,
    });

    expect(response.status).toBe(200);
  });

  it("accepts a same-origin parent resource used by the official MCP SDK", async () => {
    const serverUrl = "https://93.184.216.34/api/mcp";

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      advertisedResource: "https://93.184.216.34/api",
    });

    expect(response.status).toBe(200);
  });

  it("accepts an origin resource for a path endpoint for ecosystem compatibility", async () => {
    const serverUrl = "https://93.184.216.34/api/mcp";

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      advertisedResource: "https://93.184.216.34",
    });

    expect(response.status).toBe(200);
  });

  it("accepts an origin resource discovered through the root well-known fallback", async () => {
    const serverUrl = "https://93.184.216.34/api/mcp";
    const metadataUrl = rootProtectedResourceMetadataUrl(serverUrl);

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      metadataUrl,
      advertisedResource: "https://93.184.216.34",
    });

    expect(response.status).toBe(200);
  });

  it("preserves explicit HTTP loopback support for local development", async () => {
    const serverUrl = "http://127.0.0.1:4321/api/mcp";

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      advertisedResource: "http://127.0.0.1:4321",
      allowLoopback: true,
    });

    expect(response.status).toBe(200);
  });

  it("rejects a same-origin sibling resource", async () => {
    const serverUrl = "https://93.184.216.34/api/mcp";

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      advertisedResource: "https://93.184.216.34/other",
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Protected-resource metadata does not match serverUrl",
    });
  });

  it("uses path-segment boundaries when matching parent resources", async () => {
    const serverUrl = "https://93.184.216.34/api-evil/mcp";

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      advertisedResource: "https://93.184.216.34/api",
    });

    expect(response.status).toBe(502);
  });

  it("rejects a resource on a different origin", async () => {
    const serverUrl = "https://93.184.216.34/api/mcp";

    const response = await requestProtectedResourceMetadata({
      serverUrl,
      advertisedResource: "https://93.184.216.36/api",
    });

    expect(response.status).toBe(502);
  });

  it.each([
    "http://93.184.216.34/api",
    "https://user:password@93.184.216.34/api",
    "https://93.184.216.34/api#fragment",
    "not a URL",
  ])(
    "rejects an unsafe or invalid advertised resource: %s",
    async (resource) => {
      const serverUrl = "https://93.184.216.34/api/mcp";

      const response = await requestProtectedResourceMetadata({
        serverUrl,
        advertisedResource: resource,
      });

      expect(response.status).toBe(502);
    }
  );
});
