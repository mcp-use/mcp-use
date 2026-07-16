import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountOAuthProxy } from "../../../src/server/oauth/proxy.js";

const SERVER_URL = "https://8.8.8.8/mcp";
const PRM_URL = "https://8.8.8.8/.well-known/oauth-protected-resource/mcp";
const ISSUER = "https://1.1.1.1/oauth";
const AS_METADATA_URL =
  "https://1.1.1.1/.well-known/oauth-authorization-server/oauth";
const TOKEN_URL = "https://9.9.9.9/token";
const REGISTER_URL = "https://9.9.9.9/register";

describe("mountOAuthProxy", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fails closed for loopback and private-network targets", async () => {
    const app = createApp();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    const loopback = await metadataRequest(
      app,
      "http://localhost:3000/mcp",
      "http://localhost:3000/.well-known/oauth-protected-resource/mcp"
    );
    const privateIp = await metadataRequest(
      app,
      "https://10.0.0.4/mcp",
      "https://10.0.0.4/.well-known/oauth-protected-resource/mcp"
    );

    expect(loopback.status).toBe(400);
    expect(privateIp.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows only metadata and POST endpoints bound through discovery", async () => {
    const app = createApp();
    await discover(app);

    const unbound = await app.request("/oauth/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl: SERVER_URL,
        url: "https://9.9.9.9/userinfo",
        method: "POST",
      }),
    });
    const authorization = await app.request("/oauth/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl: SERVER_URL,
        url: "https://9.9.9.9/authorize",
        method: "POST",
      }),
    });
    const wrongMethod = await app.request("/oauth/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl: SERVER_URL,
        url: TOKEN_URL,
        method: "GET",
      }),
    });

    expect(unbound.status).toBe(403);
    expect(authorization.status).toBe(403);
    expect(wrongMethod.status).toBe(405);
  });

  it("passes protected-resource metadata through without rewriting", async () => {
    const app = createApp();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        resource: SERVER_URL,
        authorization_servers: [ISSUER],
      })
    ) as typeof fetch;

    const response = await metadataRequest(app, SERVER_URL, PRM_URL);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.resource).toBe(SERVER_URL);
    expect(body).not.toHaveProperty("_original_resource");
  });

  it("passes token responses through while stripping unsafe headers", async () => {
    const app = createApp();
    await discover(app);
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const requestHeaders = new Headers(init?.headers);
        expect(requestHeaders.get("authorization")).toBe("Basic abc");
        expect(requestHeaders.get("cookie")).toBeNull();
        expect(requestHeaders.get("x-forwarded-host")).toBeNull();
        return new Response(JSON.stringify({ access_token: "token" }), {
          status: 201,
          statusText: "Created",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Set-Cookie": "session=secret",
            "X-Upstream-Secret": "secret",
          },
        });
      }
    );
    globalThis.fetch = fetchSpy as typeof fetch;

    const response = await app.request("/oauth/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl: SERVER_URL,
        url: TOKEN_URL,
        method: "POST",
        headers: {
          Authorization: "Basic abc",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: "session=browser",
          "X-Forwarded-Host": "internal",
        },
        body: "grant_type=authorization_code&code=abc",
      }),
    });
    const body = await response.json();

    expect(body).toEqual({
      status: 201,
      statusText: "Created",
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
      },
      body: { access_token: "token" },
    });
  });

  it("re-discovers endpoint bindings when callback traffic hits a fresh BFF instance", async () => {
    const app = createApp();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === PRM_URL) {
        return jsonResponse({
          resource: SERVER_URL,
          authorization_servers: [ISSUER],
        });
      }
      if (url === AS_METADATA_URL) {
        return jsonResponse({
          issuer: ISSUER,
          authorization_endpoint: "https://9.9.9.9/authorize",
          token_endpoint: TOKEN_URL,
        });
      }
      if (url === TOKEN_URL) {
        return jsonResponse({ access_token: "fresh-instance-token" });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const response = await app.request("/oauth/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverUrl: SERVER_URL,
        url: TOKEN_URL,
        method: "POST",
        body: "grant_type=authorization_code&code=abc",
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).body).toEqual({
      access_token: "fresh-instance-token",
    });
  });
});

function createApp(): Hono {
  const app = new Hono();
  mountOAuthProxy(app, { enableLogging: false });
  return app;
}

async function discover(app: Hono): Promise<void> {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === PRM_URL) {
      return jsonResponse({
        resource: SERVER_URL,
        authorization_servers: [ISSUER],
      });
    }
    if (url === AS_METADATA_URL) {
      return jsonResponse({
        issuer: ISSUER,
        authorization_endpoint: "https://9.9.9.9/authorize",
        token_endpoint: TOKEN_URL,
        registration_endpoint: REGISTER_URL,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  expect((await metadataRequest(app, SERVER_URL, PRM_URL)).status).toBe(200);
  expect((await metadataRequest(app, SERVER_URL, AS_METADATA_URL)).status).toBe(
    200
  );
}

function metadataRequest(
  app: Hono,
  serverUrl: string,
  url: string,
  headers?: Record<string, string>
): Promise<Response> {
  const query = new URLSearchParams({ serverUrl, url });
  return app.request(`/oauth/metadata?${query}`, { headers });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
