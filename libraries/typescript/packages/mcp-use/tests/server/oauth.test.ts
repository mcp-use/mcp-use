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
import { setupOAuthForServer } from "../../src/server/oauth/setup.js";
import {
  oauthProxy,
  jwksVerifier,
} from "../../src/server/oauth/oauth-proxy.js";
import { oauthCustomProvider } from "../../src/server/oauth/providers.js";

// A stub verifier that accepts any token. Used in tests that don't exercise
// the verification path (routes, metadata, registration).
const stubVerifyToken = async () => ({ payload: {} });

async function registerOAuthProxyClient(
  baseUrl: string,
  redirectUris: string[]
): Promise<{ client_id: string; token_endpoint_auth_method: string }> {
  const response = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Test MCP Client",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
    }),
  });
  expect(response.status).toBe(201);
  return response.json();
}

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
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
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
    // Verify that client credentials were injected and redirect_uri was
    // rewritten to the brokered callback (it must match the authorize request)
    expect(tokenSpy.mock.calls[0][0].body).toMatchObject({
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: `${svc.baseUrl}/oauth/callback`,
      client_id: "my-client-id",
      client_secret: "my-client-secret",
    });
  });

  it("brokers the authorize redirect through the local /oauth/callback", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "my-client-id",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, svc.baseUrl);

    const clientRedirectUri =
      "https://client.example.com/inspector/oauth/callback?session=42";
    const registration = await registerOAuthProxyClient(svc.baseUrl, [
      clientRedirectUri,
    ]);

    const authorizeUrl = new URL(`${svc.baseUrl}/authorize`);
    authorizeUrl.searchParams.set("client_id", registration.client_id);
    authorizeUrl.searchParams.set("redirect_uri", clientRedirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", "challenge-abc");
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", "client-state-xyz");

    const response = await fetch(authorizeUrl, { redirect: "manual" });
    expect(response.status).toBe(302);

    const upstream = new URL(response.headers.get("location")!);
    // Upstream sees only the proxy's callback — clients never need their own
    // redirect URIs registered on the provider
    expect(upstream.searchParams.get("redirect_uri")).toBe(
      `${svc.baseUrl}/oauth/callback`
    );
    // PKCE passes through end-to-end
    expect(upstream.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(upstream.searchParams.get("client_id")).toBe("my-client-id");
    // The client's redirect_uri and state ride inside the upstream state
    const upstreamState = upstream.searchParams.get("state")!;
    expect(upstreamState).not.toBe("client-state-xyz");

    // Simulate the upstream provider redirecting back to the broker
    const callbackUrl = new URL(`${svc.baseUrl}/oauth/callback`);
    callbackUrl.searchParams.set("code", "upstream-code-123");
    callbackUrl.searchParams.set("state", upstreamState);

    const callback = await fetch(callbackUrl, { redirect: "manual" });
    expect(callback.status).toBe(302);

    const clientRedirect = new URL(callback.headers.get("location")!);
    expect(clientRedirect.origin).toBe("https://client.example.com");
    expect(clientRedirect.pathname).toBe("/inspector/oauth/callback");
    // Pre-existing query params on the client redirect_uri survive
    expect(clientRedirect.searchParams.get("session")).toBe("42");
    expect(clientRedirect.searchParams.get("code")).toBe("upstream-code-123");
    expect(clientRedirect.searchParams.get("state")).toBe("client-state-xyz");
  });

  it("forwards upstream errors to the client's redirect_uri", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "my-client-id",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, svc.baseUrl);

    const clientRedirectUri = "https://client.example.com/callback";
    const registration = await registerOAuthProxyClient(svc.baseUrl, [
      clientRedirectUri,
    ]);

    const authorizeUrl = new URL(`${svc.baseUrl}/authorize`);
    authorizeUrl.searchParams.set("client_id", registration.client_id);
    authorizeUrl.searchParams.set("redirect_uri", clientRedirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", "challenge");
    authorizeUrl.searchParams.set("state", "client-state");

    const response = await fetch(authorizeUrl, { redirect: "manual" });
    const upstreamState = new URL(
      response.headers.get("location")!
    ).searchParams.get("state")!;

    const callbackUrl = new URL(`${svc.baseUrl}/oauth/callback`);
    callbackUrl.searchParams.set("error", "access_denied");
    callbackUrl.searchParams.set("error_description", "User cancelled");
    callbackUrl.searchParams.set("state", upstreamState);

    const callback = await fetch(callbackUrl, { redirect: "manual" });
    expect(callback.status).toBe(302);

    const clientRedirect = new URL(callback.headers.get("location")!);
    expect(clientRedirect.searchParams.get("error")).toBe("access_denied");
    expect(clientRedirect.searchParams.get("error_description")).toBe(
      "User cancelled"
    );
    expect(clientRedirect.searchParams.get("state")).toBe("client-state");
    expect(clientRedirect.searchParams.get("code")).toBeNull();
  });

  it("falls through /oauth/callback when state is not a broker transaction", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "my-client-id",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, svc.baseUrl);

    // A same-origin frontend may serve its own callback page at this path
    // (useMcp defaults to `<origin>/oauth/callback`)
    app.get("/oauth/callback", (c) => c.text("frontend callback page"));

    const response = await fetch(
      `${svc.baseUrl}/oauth/callback?code=abc&state=random-client-state`
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("frontend callback page");

    // Without a downstream route, an unrecognized state 404s
    const app2 = new Hono();
    const svc2 = await listenOnRandomPort(app2);
    closers.push(svc2.close);
    setupOAuthRoutes(app2, proxy, svc2.baseUrl);

    const notFound = await fetch(
      `${svc2.baseUrl}/oauth/callback?code=abc&state=garbage`
    );
    expect(notFound.status).toBe(404);
  });

  it("jwksVerifier rejects opaque (non-JWT) tokens with an actionable hint", async () => {
    const verify = jwksVerifier({
      jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
      issuer: "https://issuer.example.com/",
      audience: "https://api.example.com",
    });

    // An opaque Auth0 token (no dots) is rejected before any network/JWKS call,
    // with a message that points at the missing `audience` rather than jose's
    // cryptic "Invalid Compact JWS".
    await expect(verify("opaque-token-without-dots")).rejects.toThrow(
      /not a signed JWT.*audience/s
    );

    // A malformed two-segment token is likewise caught early.
    await expect(verify("header.payload")).rejects.toThrow(/not a signed JWT/);
  });

  it("rejects authorize requests with an invalid redirect_uri", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "my-client-id",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, svc.baseUrl);

    const authorizeUrl = new URL(`${svc.baseUrl}/authorize`);
    authorizeUrl.searchParams.set("client_id", "client");
    authorizeUrl.searchParams.set("redirect_uri", "not-a-url");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", "challenge");

    const response = await fetch(authorizeUrl, { redirect: "manual" });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_request");
  });

  it("allows browser GET to /mcp through OAuth when publicLandingPage is enabled", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client",
      verifyToken: async () => ({
        payload: { sub: "user-1", scope: "openid profile" },
      }),
    });

    await setupOAuthForServer(
      app,
      proxy,
      "http://localhost:3000",
      { complete: false },
      { publicLandingPage: true }
    );
    app.get("/mcp", (c) =>
      c.html("<html><body>landing</body></html>", 200, {
        "Content-Type": "text/html; charset=utf-8",
      })
    );

    const response = await app.request("/mcp", {
      headers: { Accept: "text/html" },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("landing");
  });

  it("still requires bearer token for MCP JSON at /mcp when publicLandingPage is enabled", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client",
      verifyToken: async () => ({
        payload: { sub: "user-1", scope: "openid profile" },
      }),
    });

    await setupOAuthForServer(
      app,
      proxy,
      "http://localhost:3000",
      { complete: false },
      { publicLandingPage: true }
    );
    app.post("/mcp", (c) => c.json({ ok: true }));

    const unauthorized = await app.request("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(unauthorized.status).toBe(401);
  });

  it("requires bearer token for /mcp when publicLandingPage is disabled", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client",
      verifyToken: async () => ({
        payload: { sub: "user-1", scope: "openid profile" },
      }),
    });

    await setupOAuthForServer(app, proxy, "http://localhost:3000", {
      complete: false,
    });
    app.get("/mcp", (c) => c.html("<html><body>landing</body></html>"));

    const unauthorized = await app.request("/mcp", {
      headers: { Accept: "text/html" },
    });
    expect(unauthorized.status).toBe(401);
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

  it("does not expose token verification internals to clients", async () => {
    const app = new Hono();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client",
      verifyToken: async () => {
        throw new Error(
          "JWKS fetch failed at https://issuer.example.com/.well-known/jwks.json"
        );
      },
    });

    app.use("/mcp/*", createBearerAuthMiddleware(proxy));
    app.get("/mcp/test", (c) => c.json({ ok: true }));

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    const response = await fetch(`${svc.baseUrl}/mcp/test`, {
      headers: { Authorization: "Bearer token-123" },
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Invalid token" });
    expect(JSON.stringify(body)).not.toContain("JWKS");
    expect(JSON.stringify(body)).not.toContain("issuer.example.com");
    expect(errorSpy).toHaveBeenCalledWith(
      "[OAuth Middleware] Token verification failed:",
      expect.any(Error)
    );

    errorSpy.mockRestore();
  });

  it("protects the /sse transport with bearer auth (regression: /sse bypass)", async () => {
    const app = new Hono();

    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "test-client",
      verifyToken: async () => ({
        payload: { sub: "user-1", scope: "openid profile" },
      }),
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    // Register OAuth via the real setup path (mirrors MCPServer.listen()).
    await setupOAuthForServer(app, proxy, svc.baseUrl, { complete: false });

    // Stub handlers standing in for the mounted MCP JSON-RPC handler. These are
    // registered after the middleware, matching mountMcp() ordering.
    for (const endpoint of ["/mcp", "/sse"]) {
      app.on(["GET", "POST"], endpoint, (c) => c.json({ ok: true }));
    }

    // Unauthenticated requests to /sse must be rejected (the bypass).
    const sseGet = await fetch(`${svc.baseUrl}/sse`);
    expect(sseGet.status).toBe(401);

    const ssePost = await fetch(`${svc.baseUrl}/sse`, { method: "POST" });
    expect(ssePost.status).toBe(401);

    // Authenticated requests to /sse reach the handler.
    const sseAuthorized = await fetch(`${svc.baseUrl}/sse`, {
      headers: { Authorization: "Bearer token-123" },
    });
    expect(sseAuthorized.status).toBe(200);

    // /mcp remains protected too.
    const mcpUnauthorized = await fetch(`${svc.baseUrl}/mcp`);
    expect(mcpUnauthorized.status).toBe(401);

    // Path-scoped protected-resource metadata is advertised for /sse.
    const metaResponse = await fetch(
      `${svc.baseUrl}/.well-known/oauth-protected-resource/sse`
    );
    expect(metaResponse.status).toBe(200);
    const metadata = await metaResponse.json();
    expect(metadata.resource).toBe(`${svc.baseUrl}/sse`);
  });

  it("proxies OAuth metadata for path-suffix issuers at canonical well-known paths", async () => {
    const upstream = new Hono();
    const upstreamSvc = await listenOnRandomPort(upstream);
    closers.push(upstreamSvc.close);

    const issuer = `${upstreamSvc.baseUrl}/oauth/2.1`;
    const upstreamMetadata = {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    };

    upstream.get("/.well-known/oauth-authorization-server/oauth/2.1", (c) =>
      c.json(upstreamMetadata)
    );
    upstream.get("/oauth/2.1/.well-known/openid-configuration", (c) =>
      c.json({ ...upstreamMetadata, scopes_supported: ["openid"] })
    );

    const app = new Hono();
    const provider = oauthCustomProvider({
      issuer,
      authEndpoint: upstreamMetadata.authorization_endpoint,
      tokenEndpoint: upstreamMetadata.token_endpoint,
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, provider, svc.baseUrl);

    const rootResponse = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server`
    );
    expect(rootResponse.status).toBe(200);
    expect(await rootResponse.json()).toEqual(upstreamMetadata);

    const canonicalResponse = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server/oauth/2.1`
    );
    expect(canonicalResponse.status).toBe(200);
    expect(await canonicalResponse.json()).toEqual(upstreamMetadata);

    // OIDC discovery is served only at the root local route, which fetches the
    // append-form upstream URL (`{issuer}/.well-known/openid-configuration`).
    const openIdResponse = await fetch(
      `${svc.baseUrl}/.well-known/openid-configuration`
    );
    expect(openIdResponse.status).toBe(200);
    expect(await openIdResponse.json()).toMatchObject({
      issuer: upstreamMetadata.issuer,
      scopes_supported: ["openid"],
    });
  });

  it("returns a local public client registration from /register", async () => {
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
    expect(registration.client_id).not.toBe("pre-registered-client-id");
    expect(registration.client_name).toBe("My MCP Client");
    expect(registration.client_secret).toBeUndefined();
    expect(registration.token_endpoint_auth_method).toBe("none");
  });

  it("brokers a dynamically registered MCP client without upstream redirect allowlisting", async () => {
    const tokenSpy = vi.fn();
    const upstream = new Hono();
    upstream.post("/oauth/token", async (c) => {
      tokenSpy(await c.req.parseBody());
      return c.json({
        access_token: "upstream-access-token",
        token_type: "Bearer",
      });
    });
    const upstreamSvc = await listenOnRandomPort(upstream);
    closers.push(upstreamSvc.close);

    const app = new Hono();

    const proxy = oauthProxy({
      issuer: upstreamSvc.baseUrl,
      authEndpoint: `${upstreamSvc.baseUrl}/oauth/authorize`,
      tokenEndpoint: `${upstreamSvc.baseUrl}/oauth/token`,
      clientId: "upstream-pre-registered-client",
      clientSecret: "upstream-client-secret",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    setupOAuthRoutes(app, proxy, svc.baseUrl);

    const clientRedirectUri =
      "https://new-mcp-client.example.com/oauth/callback";
    const registrationResponse = await fetch(`${svc.baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Previously Unknown MCP Client",
        redirect_uris: [clientRedirectUri],
        token_endpoint_auth_method: "none",
      }),
    });

    expect(registrationResponse.status).toBe(201);
    const registration = await registrationResponse.json();
    expect(registration.client_id).not.toBe("upstream-pre-registered-client");
    expect(registration.client_secret).toBeUndefined();
    expect(registration.token_endpoint_auth_method).toBe("none");

    const authorizeUrl = new URL(`${svc.baseUrl}/authorize`);
    authorizeUrl.searchParams.set("client_id", registration.client_id);
    authorizeUrl.searchParams.set("redirect_uri", clientRedirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", "client-pkce-challenge");
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", "client-state");

    const authorizeResponse = await fetch(authorizeUrl, {
      redirect: "manual",
    });
    expect(authorizeResponse.status).toBe(302);

    const upstreamAuthorizeUrl = new URL(
      authorizeResponse.headers.get("location")!
    );
    expect(upstreamAuthorizeUrl.searchParams.get("client_id")).toBe(
      "upstream-pre-registered-client"
    );
    expect(upstreamAuthorizeUrl.searchParams.get("redirect_uri")).toBe(
      `${svc.baseUrl}/oauth/callback`
    );

    const callbackUrl = new URL(`${svc.baseUrl}/oauth/callback`);
    callbackUrl.searchParams.set("code", "upstream-code");
    callbackUrl.searchParams.set(
      "state",
      upstreamAuthorizeUrl.searchParams.get("state")!
    );
    const callbackResponse = await fetch(callbackUrl, {
      redirect: "manual",
    });

    expect(callbackResponse.status).toBe(302);
    const finalRedirect = new URL(callbackResponse.headers.get("location")!);
    expect(finalRedirect.origin + finalRedirect.pathname).toBe(
      clientRedirectUri
    );
    expect(finalRedirect.searchParams.get("code")).toBe("upstream-code");
    expect(finalRedirect.searchParams.get("state")).toBe("client-state");

    const tokenResponse = await fetch(`${svc.baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registration.client_id,
        code: "upstream-code",
        code_verifier: "client-pkce-verifier",
        redirect_uri: clientRedirectUri,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    expect(await tokenResponse.json()).toMatchObject({
      access_token: "upstream-access-token",
    });
    expect(tokenSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        grant_type: "authorization_code",
        client_id: "upstream-pre-registered-client",
        client_secret: "upstream-client-secret",
        code: "upstream-code",
        code_verifier: "client-pkce-verifier",
        redirect_uri: `${svc.baseUrl}/oauth/callback`,
      })
    );

    const mismatchedAuthorizeUrl = new URL(authorizeUrl);
    mismatchedAuthorizeUrl.searchParams.set(
      "redirect_uri",
      "https://attacker.example.com/callback"
    );
    const mismatchedResponse = await fetch(mismatchedAuthorizeUrl, {
      redirect: "manual",
    });
    expect(mismatchedResponse.status).toBe(400);
    expect(await mismatchedResponse.json()).toMatchObject({
      error: "invalid_request",
    });

    const nativeRedirectUri = "cursor://anysphere.cursor-mcp/oauth/callback";
    const nativeRegistration = await registerOAuthProxyClient(svc.baseUrl, [
      nativeRedirectUri,
    ]);
    const nativeAuthorizeUrl = new URL(`${svc.baseUrl}/authorize`);
    nativeAuthorizeUrl.searchParams.set(
      "client_id",
      nativeRegistration.client_id
    );
    nativeAuthorizeUrl.searchParams.set("redirect_uri", nativeRedirectUri);
    nativeAuthorizeUrl.searchParams.set("response_type", "code");
    nativeAuthorizeUrl.searchParams.set(
      "code_challenge",
      "native-client-challenge"
    );

    const nativeAuthorizeResponse = await fetch(nativeAuthorizeUrl, {
      redirect: "manual",
    });
    expect(nativeAuthorizeResponse.status).toBe(302);
  });

  it("validates stateless registrations across proxy instances", async () => {
    const baseUrl = "https://mcp.example.com";
    const createProxy = () =>
      oauthProxy({
        issuer: "https://issuer.example.com",
        authEndpoint: "https://issuer.example.com/oauth/authorize",
        tokenEndpoint: "https://issuer.example.com/oauth/token",
        clientId: "upstream-public-client",
        registrationSecret: "shared-registration-secret",
        verifyToken: stubVerifyToken,
      });

    const registrationApp = new Hono();
    setupOAuthRoutes(registrationApp, createProxy(), baseUrl);
    const registrationResponse = await registrationApp.request(
      `${baseUrl}/register`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Distributed MCP Client",
          redirect_uris: ["https://client.example.com/callback"],
        }),
      }
    );
    expect(registrationResponse.status).toBe(201);
    const registration = await registrationResponse.json();

    const authorizationApp = new Hono();
    setupOAuthRoutes(authorizationApp, createProxy(), baseUrl);
    const authorizeUrl = new URL(`${baseUrl}/authorize`);
    authorizeUrl.searchParams.set("client_id", registration.client_id);
    authorizeUrl.searchParams.set(
      "redirect_uri",
      "https://client.example.com/callback"
    );
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", "challenge");

    const authorizeResponse = await authorizationApp.request(authorizeUrl);
    expect(authorizeResponse.status).toBe(302);
  });
});
