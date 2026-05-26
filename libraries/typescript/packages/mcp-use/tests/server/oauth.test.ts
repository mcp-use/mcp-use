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
import type { OAuthProvider } from "../../src/server/oauth/providers/types.js";

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

    setupOAuthRoutes(app, proxy, svc.baseUrl);

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

    setupOAuthRoutes(app, proxy, svc.baseUrl);

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

    setupOAuthRoutes(app, proxy, svc.baseUrl);

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

  it("fetches metadata from upstream provider with path-suffix issuer (RFC 8414)", async () => {
    // This test verifies the fix for issuers with path components
    // Example: PropelAuth's https://auth.<tenant>.com/oauth/2.1

    // Track the URL that was requested to verify RFC 8414 compliance
    const metadataSpy = vi.fn();

    // Upstream OAuth server with a path-suffix issuer
    // Per RFC 8414, the well-known segment goes between host and path
    // So for issuer https://auth.example.com/oauth/2.1,
    // the metadata URL should be https://auth.example.com/.well-known/oauth-authorization-server/oauth/2.1
    const upstream = new Hono();
    upstream.get("/.well-known/oauth-authorization-server/*", async (c) => {
      const pathname = new URL(c.req.url).pathname;
      metadataSpy(pathname);
      
      // Return metadata with the issuer matching the upstream base URL
      return c.json({
        issuer: `${c.req.url.split('/.well-known')[0]}/oauth/2.1`,
        authorization_endpoint: `${c.req.url.split('/.well-known')[0]}/oauth/2.1/authorize`,
        token_endpoint: `${c.req.url.split('/.well-known')[0]}/oauth/2.1/token`,
        registration_endpoint: `${c.req.url.split('/.well-known')[0]}/oauth/2.1/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
    });

    const upstreamSvc = await listenOnRandomPort(upstream);
    closers.push(upstreamSvc.close);

    // Create a mock OAuthProvider for DCR-direct mode
    const mockProvider: OAuthProvider = {
      getIssuer: () => `${upstreamSvc.baseUrl}/oauth/2.1`,
      getAuthEndpoint: () =>
        `${upstreamSvc.baseUrl}/oauth/2.1/authorize`,
      getTokenEndpoint: () => `${upstreamSvc.baseUrl}/oauth/2.1/token`,
      getScopesSupported: () => ["openid", "profile"],
      getGrantTypesSupported: () => ["authorization_code"],
      verifyToken: stubVerifyToken,
      getUserInfo: () => ({
        userId: "test-user",
        email: "test@example.com",
      }),
    };

    const app = new Hono();
    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, mockProvider, svc.baseUrl);

    // Request the metadata from the MCP server
    const response = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server`
    );

    expect(response.status).toBe(200);

    const metadata = await response.json();
    // The metadata issuer should match what the upstream returned (based on its local URL)
    expect(metadata.issuer).toContain("/oauth/2.1");

    // Verify that the upstream was called with RFC 8414 compliant path
    // The well-known segment should be between the host and the path
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(metadataSpy.mock.calls[0][0]).toBe(
      "/.well-known/oauth-authorization-server/oauth/2.1"
    );
  });

  it("fetches OIDC configuration from upstream with path-suffix issuer", async () => {
    // Test the same RFC 8414 fix for the OIDC discovery endpoint
    // Note: Both endpoints use the same handler, so they both fetch from
    // /.well-known/oauth-authorization-server on the upstream
    const metadataSpy = vi.fn();

    const upstream = new Hono();
    // Both discovery endpoints fetch from oauth-authorization-server
    upstream.get("/.well-known/oauth-authorization-server/*", async (c) => {
      const pathname = new URL(c.req.url).pathname;
      metadataSpy(pathname);
      
      // Return metadata with the issuer matching the upstream base URL
      return c.json({
        issuer: `${c.req.url.split('/.well-known')[0]}/oauth/2.1`,
        authorization_endpoint: `${c.req.url.split('/.well-known')[0]}/oauth/2.1/authorize`,
        token_endpoint: `${c.req.url.split('/.well-known')[0]}/oauth/2.1/token`,
        registration_endpoint: `${c.req.url.split('/.well-known')[0]}/oauth/2.1/register`,
        userinfo_endpoint: `${c.req.url.split('/.well-known')[0]}/oauth/2.1/userinfo`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    });

    const upstreamSvc = await listenOnRandomPort(upstream);
    closers.push(upstreamSvc.close);

    const mockProvider: OAuthProvider = {
      getIssuer: () => `${upstreamSvc.baseUrl}/oauth/2.1`,
      getAuthEndpoint: () =>
        `${upstreamSvc.baseUrl}/oauth/2.1/authorize`,
      getTokenEndpoint: () => `${upstreamSvc.baseUrl}/oauth/2.1/token`,
      getScopesSupported: () => ["openid", "profile"],
      getGrantTypesSupported: () => ["authorization_code"],
      verifyToken: stubVerifyToken,
      getUserInfo: () => ({
        userId: "test-user",
        email: "test@example.com",
      }),
    };

    const app = new Hono();
    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, mockProvider, svc.baseUrl);

    const response = await fetch(
      `${svc.baseUrl}/.well-known/openid-configuration`
    );

    expect(response.status).toBe(200);

    const metadata = await response.json();
    expect(metadata.issuer).toContain("/oauth/2.1");
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    // The handler constructs the RFC 8414 compliant path
    expect(metadataSpy.mock.calls[0][0]).toBe(
      "/.well-known/oauth-authorization-server/oauth/2.1"
    );
  });
});
