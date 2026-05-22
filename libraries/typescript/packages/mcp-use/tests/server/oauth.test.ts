/**
 * OAuth integration tests
 *
 * Tests both the new oauthProxy() function (for non-DCR providers like Google)
 * and the bearer auth middleware.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBearerAuthMiddleware } from "../../src/server/oauth/middleware.js";
import { setupOAuthRoutes } from "../../src/server/oauth/routes.js";
import { oauthProxy } from "../../src/server/oauth/oauth-proxy.js";

// A stub verifier that accepts any token. Used in tests that don't exercise
// the verification path (routes, metadata, registration).
const stubVerifyToken = async () => ({ payload: {} });

async function listenOnRandomPort(
  app: Hono
): Promise<{ baseUrl: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({
        baseUrl: `http://127.0.0.1:${info.port}`,
        close: () => server.close(),
      });
    });
  });
}

const closers: Array<() => void> = [];

afterEach(() => {
  while (closers.length > 0) {
    closers.pop()?.();
  }
});

describe("server OAuth integration", () => {
  it("advertises proxy endpoints in discovery metadata", async () => {
    const app = new Hono();

    // Use oauthProxy() for providers without DCR support
    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client-id",
      scopes: ["openid", "profile"],
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, () => svc.baseUrl);

    const response = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server`
    );
    const metadata = await response.json();

    expect(response.status).toBe(200);
    expect(metadata.authorization_endpoint).toBe(`${svc.baseUrl}/authorize`);
    expect(metadata.token_endpoint).toBe(`${svc.baseUrl}/token`);
    expect(metadata.registration_endpoint).toBe(`${svc.baseUrl}/register`);
    // In proxy mode, the issuer is the local server URL
    expect(metadata.issuer).toBe(svc.baseUrl);
  });

  it("publishes basePath-prefixed endpoints when configured", async () => {
    // `setupOAuthRoutes` takes the underlying root Hono plus a basePath.
    // Internally it registers /authorize, /token, /register on a
    // `.basePath()` clone (so they live at `${basePath}/...`) and
    // /.well-known/* on the root (per RFC 8414 §3.1).
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client-id",
      scopes: ["openid"],
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, () => svc.baseUrl, "/api");

    // RFC 8414 §3.1 path-aware variant: well-known appended with the
    // issuer's path. This is the SDK's preferred probe.
    const response = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server/api`
    );
    expect(response.status).toBe(200);
    const metadata = await response.json();

    expect(metadata.issuer).toBe(`${svc.baseUrl}/api`);
    expect(metadata.authorization_endpoint).toBe(
      `${svc.baseUrl}/api/authorize`
    );
    expect(metadata.token_endpoint).toBe(`${svc.baseUrl}/api/token`);
    expect(metadata.registration_endpoint).toBe(`${svc.baseUrl}/api/register`);

    // The root well-known path should still serve metadata as the SDK's
    // fallback probe (and for clients that don't append the path).
    const rootMetadata = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server`
    );
    expect(rootMetadata.status).toBe(200);

    // RFC 9728 path-scoped protected resource metadata for the MCP transport.
    const prResponse = await fetch(
      `${svc.baseUrl}/.well-known/oauth-protected-resource/api/mcp`
    );
    expect(prResponse.status).toBe(200);
    const pr = await prResponse.json();
    expect(pr.resource).toBe(`${svc.baseUrl}/api/mcp`);
  });

  it("proxies token requests and injects client credentials", async () => {
    const tokenSpy = vi.fn();

    // Upstream token server
    const upstream = new Hono();
    upstream.post("/oauth/token", async (c) => {
      const body = await c.req.parseBody();
      tokenSpy({
        body,
      });
      return c.json({
        access_token: "abc",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });

    const upstreamSvc = await listenOnRandomPort(upstream);
    closers.push(upstreamSvc.close);

    const app = new Hono();

    // Use oauthProxy() with client credentials
    const proxy = oauthProxy({
      issuer: upstreamSvc.baseUrl,
      authEndpoint: `${upstreamSvc.baseUrl}/oauth/authorize`,
      tokenEndpoint: `${upstreamSvc.baseUrl}/oauth/token`,
      clientId: "my-client-id",
      clientSecret: "my-client-secret",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, () => svc.baseUrl);

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: "http://localhost:3000/callback",
    });

    const response = await fetch(`${svc.baseUrl}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.access_token).toBe("abc");
    expect(tokenSpy).toHaveBeenCalledTimes(1);
    // Verify that client credentials were injected
    expect(tokenSpy.mock.calls[0][0].body).toMatchObject({
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: "http://localhost:3000/callback",
      client_id: "my-client-id",
      client_secret: "my-client-secret",
    });
  });

  it("rejects /mcp requests without bearer token", async () => {
    const app = new Hono();

    // Supply a verifyToken that accepts the stubbed bearer.
    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client",
      verifyToken: async () => ({
        payload: { sub: "user-1", scope: "openid profile" },
      }),
    });

    app.use("/mcp/*", createBearerAuthMiddleware(proxy));
    app.get("/mcp/test", (c) => c.json({ ok: true }));

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    const unauthorized = await fetch(`${svc.baseUrl}/mcp/test`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${svc.baseUrl}/mcp/test`, {
      headers: { Authorization: "Bearer token-123" },
    });
    expect(authorized.status).toBe(200);
  });

  it("advertises path-aware resource_metadata URL with basePath", async () => {
    // Per RFC 9728 §3.1, the resource metadata URL is built by inserting
    // `/.well-known/oauth-protected-resource` between host and the resource
    // path. For an MCP endpoint at `<host>/api/mcp` that's
    // `<host>/.well-known/oauth-protected-resource/api/mcp`.
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    app.use(
      "/api/mcp/*",
      createBearerAuthMiddleware(proxy, () => svc.baseUrl, "/api")
    );
    app.get("/api/mcp/test", (c) => c.json({ ok: true }));

    const response = await fetch(`${svc.baseUrl}/api/mcp/test`);
    expect(response.status).toBe(401);

    const wwwAuth = response.headers.get("www-authenticate");
    expect(wwwAuth).toContain(
      `resource_metadata="${svc.baseUrl}/.well-known/oauth-protected-resource/api/mcp"`
    );
  });

  it("returns configured clientId from /register endpoint", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "pre-registered-client-id",
      clientSecret: "client-secret",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, () => svc.baseUrl);

    const response = await fetch(`${svc.baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "My MCP Client",
        redirect_uris: ["http://localhost:3000/callback"],
      }),
    });

    expect(response.status).toBe(201);

    const registration = await response.json();
    expect(registration.client_id).toBe("pre-registered-client-id");
    expect(registration.client_name).toBe("My MCP Client");
    expect(registration.token_endpoint_auth_method).toBe("client_secret_post");
  });
});
