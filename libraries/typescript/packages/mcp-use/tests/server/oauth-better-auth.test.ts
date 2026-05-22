/**
 * Better Auth OAuth provider — in-process and external modes.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupOAuthForServer } from "../../src/server/oauth/setup.js";
import { oauthBetterAuthProvider } from "../../src/server/oauth/providers.js";
import type { BetterAuthInstance } from "../../src/server/oauth/providers/types.js";

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
  while (closers.length > 0) closers.pop()?.();
});

/**
 * Build a Better Auth instance double that captures requests routed through
 * `handler` and returns canned metadata from `api.getOAuthServerConfig` /
 * `api.getOpenIdConfig`. We don't want to spin up real Better Auth here —
 * the SDK only needs the structural shape declared by {@link BetterAuthInstance}.
 */
function makeAuthDouble(opts: {
  baseURL: string;
  basePath?: string;
  authServerMetadata?: Record<string, unknown>;
  openIdConfig?: Record<string, unknown>;
}): {
  auth: BetterAuthInstance;
  handlerCalls: Array<{ url: string; method: string }>;
} {
  const handlerCalls: Array<{ url: string; method: string }> = [];
  const auth: BetterAuthInstance = {
    handler: vi.fn(async (req: Request) => {
      handlerCalls.push({ url: req.url, method: req.method });
      return new Response("ok", { status: 200 });
    }),
    options: {
      baseURL: opts.baseURL,
      ...(opts.basePath !== undefined ? { basePath: opts.basePath } : {}),
    },
    api: {
      getOAuthServerConfig: vi.fn(
        async () =>
          opts.authServerMetadata ?? {
            issuer: `${opts.baseURL}${opts.basePath ?? "/api/auth"}`,
            authorization_endpoint: `${opts.baseURL}${
              opts.basePath ?? "/api/auth"
            }/oauth2/authorize`,
            token_endpoint: `${opts.baseURL}${
              opts.basePath ?? "/api/auth"
            }/oauth2/token`,
          }
      ),
      getOpenIdConfig: vi.fn(
        async () =>
          opts.openIdConfig ?? {
            issuer: `${opts.baseURL}${opts.basePath ?? "/api/auth"}`,
          }
      ),
    },
  };
  return { auth, handlerCalls };
}

describe("oauthBetterAuthProvider — in-process mode", () => {
  it("serves discovery at the issuer-path-suffixed well-known URL", async () => {
    // The MCPServer is at basePath `/mcp-server`; Better Auth's externally-
    // visible URL is the full path `/mcp-server/api/auth`. The
    // spec-compliant path-insertion probe is
    // `/.well-known/oauth-authorization-server/mcp-server/api/auth` at the
    // literal host root.
    const app = new Hono();
    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    const { auth } = makeAuthDouble({
      baseURL: `${svc.baseUrl}/mcp-server/api/auth`,
      authServerMetadata: {
        issuer: `${svc.baseUrl}/mcp-server/api/auth`,
        authorization_endpoint: `${svc.baseUrl}/mcp-server/api/auth/oauth2/authorize`,
        token_endpoint: `${svc.baseUrl}/mcp-server/api/auth/oauth2/token`,
      },
    });
    const provider = oauthBetterAuthProvider(auth);
    setupOAuthForServer(app, provider, () => svc.baseUrl, "/mcp-server");

    // 1. RFC 8414 §3.1 path-insertion variant at the issuer's pathname.
    const res = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server/mcp-server/api/auth`
    );
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta.issuer).toBe(`${svc.baseUrl}/mcp-server/api/auth`);
    expect(meta.authorization_endpoint).toBe(
      `${svc.baseUrl}/mcp-server/api/auth/oauth2/authorize`
    );

    // 2. Root fallback still works.
    const rootRes = await fetch(
      `${svc.baseUrl}/.well-known/oauth-authorization-server`
    );
    expect(rootRes.status).toBe(200);
  });

  it("mounts auth.handler at the issuer's path on the root app", async () => {
    const app = new Hono();
    const svc = await listenOnRandomPort(app);
    closers.push(svc.close);

    const { auth, handlerCalls } = makeAuthDouble({
      baseURL: `${svc.baseUrl}/mcp-server/api/auth`,
    });
    const provider = oauthBetterAuthProvider(auth);
    setupOAuthForServer(app, provider, () => svc.baseUrl, "/mcp-server");

    // A request under the mounted path reaches Better Auth's handler.
    const res = await fetch(`${svc.baseUrl}/mcp-server/api/auth/sign-in`);
    expect(res.status).toBe(200);
    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0].url).toContain("/mcp-server/api/auth/sign-in");
  });

  it("falls back to baseURL + basePath when baseURL has no path", () => {
    // Mirrors Better Auth's own `withPath` behavior: an origin-only
    // `baseURL` gets `basePath` appended; a `baseURL` with a path is left
    // alone. This is the value Better Auth signs into tokens as `iss`.
    const { auth: pathless } = makeAuthDouble({
      baseURL: "http://example.com",
    });
    expect(oauthBetterAuthProvider(pathless).getIssuer()).toBe(
      "http://example.com/api/auth"
    );

    const { auth: customBase } = makeAuthDouble({
      baseURL: "http://example.com",
      basePath: "/auth",
    });
    expect(oauthBetterAuthProvider(customBase).getIssuer()).toBe(
      "http://example.com/auth"
    );

    const { auth: withFullPath } = makeAuthDouble({
      baseURL: "http://example.com/anywhere/api/auth",
    });
    // basePath is ignored when baseURL already has a path.
    expect(oauthBetterAuthProvider(withFullPath).getIssuer()).toBe(
      "http://example.com/anywhere/api/auth"
    );
  });

  it("throws a helpful error when auth.options.baseURL is missing", () => {
    const auth: BetterAuthInstance = {
      handler: async () => new Response(),
      options: {},
      api: {
        getOAuthServerConfig: async () => ({}),
        getOpenIdConfig: async () => ({}),
      },
    };
    expect(() => oauthBetterAuthProvider(auth)).toThrow(
      /auth\.options\.baseURL/
    );
  });
});

describe("oauthBetterAuthProvider — external mode", () => {
  it("uses the configured authURL as the issuer", () => {
    const provider = oauthBetterAuthProvider({
      authURL: "http://auth.example.com/api/auth",
    });
    expect(provider.getIssuer()).toBe("http://auth.example.com/api/auth");
    // External mode leaves the in-process hooks undefined so the SDK falls
    // back to its default upstream-fetch metadata behavior.
    expect(provider.authorizationServerMetadataHandler).toBeUndefined();
    expect(provider.installRoutes).toBeUndefined();
  });

  it("requires either an auth instance or authURL", () => {
    expect(() => oauthBetterAuthProvider({})).toThrow(
      /Better Auth instance|authURL/
    );
  });
});
