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
import {
  setupOAuthRoutes,
  createCallbackHandler,
} from "../../src/server/oauth/routes.js";
import { setupOAuthForServer } from "../../src/server/oauth/setup.js";
import { oauthProxy } from "../../src/server/oauth/oauth-proxy.js";
import {
  createInMemoryStateStore,
  DEFAULT_OAUTH_STATE_TTL_MS,
} from "../../src/server/oauth/state-store.js";

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
    // Verify that client credentials were injected and that the
    // proxy overrides the client-supplied redirect_uri so the upstream's
    // redirect-uri match (against what was sent at /authorize) succeeds.
    expect(tokenSpy.mock.calls[0][0].body).toMatchObject({
      grant_type: "authorization_code",
      code: "code-123",
      redirect_uri: `${svc.baseUrl}/oauth/callback`,
      client_id: "my-client-id",
      client_secret: "my-client-secret",
    });
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

  it("swaps redirect_uri and state to proxy values at /authorize", async () => {
    const app = new Hono();
    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "upstream-client-id",
      verifyToken: stubVerifyToken,
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);
    setupOAuthRoutes(app, proxy, svc.baseUrl);

    const params = new URLSearchParams({
      client_id: "ignored-stale-dcr-id",
      redirect_uri: "http://localhost:5173/inspector/oauth/callback",
      response_type: "code",
      code_challenge: "challenge-123",
      state: "client-state-xyz",
      scope: "openid",
    });

    const response = await fetch(`${svc.baseUrl}/authorize?${params}`, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const upstreamUrl = new URL(response.headers.get("location")!);
    expect(upstreamUrl.origin + upstreamUrl.pathname).toBe(
      "https://issuer.example.com/oauth/authorize"
    );
    expect(upstreamUrl.searchParams.get("redirect_uri")).toBe(
      `${svc.baseUrl}/oauth/callback`
    );
    expect(upstreamUrl.searchParams.get("client_id")).toBe("upstream-client-id");
    // The forwarded state is the proxy's minted value, not the client's.
    const proxyState = upstreamUrl.searchParams.get("state");
    expect(proxyState).toBeTruthy();
    expect(proxyState).not.toBe("client-state-xyz");
  });

  it("brokers the upstream callback back to the original client URI", async () => {
    const store = createInMemoryStateStore();
    const handler = createCallbackHandler(store);
    const app = new Hono();
    app.get("/oauth/callback", handler);

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    store.set(
      "proxy-state-1",
      {
        clientRedirectUri: "http://localhost:5173/inspector/oauth/callback",
        clientState: "client-state-xyz",
      },
      DEFAULT_OAUTH_STATE_TTL_MS
    );

    const callbackUrl = new URL(`${svc.baseUrl}/oauth/callback`);
    callbackUrl.searchParams.set("code", "auth-code-abc");
    callbackUrl.searchParams.set("state", "proxy-state-1");

    const response = await fetch(callbackUrl.toString(), {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location")!);
    expect(`${target.origin}${target.pathname}`).toBe(
      "http://localhost:5173/inspector/oauth/callback"
    );
    expect(target.searchParams.get("code")).toBe("auth-code-abc");
    expect(target.searchParams.get("state")).toBe("client-state-xyz");
  });

  it("propagates upstream errors back to the client redirect URI", async () => {
    const store = createInMemoryStateStore();
    const app = new Hono();
    app.get("/oauth/callback", createCallbackHandler(store));

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    store.set(
      "proxy-state-err",
      {
        clientRedirectUri: "http://localhost:5173/cb",
        clientState: "s",
      },
      DEFAULT_OAUTH_STATE_TTL_MS
    );

    const url = new URL(`${svc.baseUrl}/oauth/callback`);
    url.searchParams.set("state", "proxy-state-err");
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "user declined");

    const response = await fetch(url.toString(), { redirect: "manual" });
    expect(response.status).toBe(302);

    const target = new URL(response.headers.get("location")!);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("error_description")).toBe("user declined");
    expect(target.searchParams.get("state")).toBe("s");
    expect(target.searchParams.get("code")).toBeNull();
  });

  it("rejects unknown or replayed state values at /oauth/callback", async () => {
    const store = createInMemoryStateStore();
    const app = new Hono();
    app.get("/oauth/callback", createCallbackHandler(store));

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    store.set(
      "proxy-state-one-shot",
      { clientRedirectUri: "http://localhost:5173/cb" },
      DEFAULT_OAUTH_STATE_TTL_MS
    );

    const url = `${svc.baseUrl}/oauth/callback?state=proxy-state-one-shot&code=c`;
    const first = await fetch(url, { redirect: "manual" });
    expect(first.status).toBe(302);

    const replay = await fetch(url, { redirect: "manual" });
    expect(replay.status).toBe(400);

    const unknown = await fetch(`${svc.baseUrl}/oauth/callback?state=nope&code=c`, {
      redirect: "manual",
    });
    expect(unknown.status).toBe(400);
  });

  it("expires state records after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryStateStore();
      store.set(
        "expiring",
        { clientRedirectUri: "http://localhost:5173/cb" },
        1000
      );
      vi.advanceTimersByTime(1001);
      expect(store.get("expiring")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects /authorize redirect_uris not in allowedClientRedirectUris", async () => {
    const app = new Hono();
    const proxy = oauthProxy({
      issuer: "https://issuer.example.com",
      authEndpoint: "https://issuer.example.com/oauth/authorize",
      tokenEndpoint: "https://issuer.example.com/oauth/token",
      clientId: "id",
      verifyToken: stubVerifyToken,
      allowedClientRedirectUris: ["http://localhost:3000/oauth/callback"],
    });

    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);
    setupOAuthRoutes(app, proxy, svc.baseUrl);

    const accepted = new URLSearchParams({
      client_id: "id",
      redirect_uri: "http://localhost:3000/oauth/callback",
      response_type: "code",
      code_challenge: "c",
    });
    const acceptedRes = await fetch(`${svc.baseUrl}/authorize?${accepted}`, {
      redirect: "manual",
    });
    expect(acceptedRes.status).toBe(302);

    const rejected = new URLSearchParams({
      client_id: "id",
      redirect_uri: "http://attacker.example.com/cb",
      response_type: "code",
      code_challenge: "c",
    });
    const rejectedRes = await fetch(`${svc.baseUrl}/authorize?${rejected}`);
    expect(rejectedRes.status).toBe(400);
    const body = await rejectedRes.json();
    expect(body.error).toBe("invalid_request");
  });
});
