import { describe, expect, it, vi } from "vitest";

import { MCPServer, type Hono } from "../src/index.js";
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthMetadata,
} from "../src/oauth/index.js";

const issuer = "https://issuer.example.test";

function provider(
  options: {
    resource?: string;
    requiredScopes?: readonly string[];
    scopesSupported?: readonly string[];
  } = {}
) {
  return oauthCustomProvider({
    ...options,
    tokenVerifier: {
      verifyAccessToken: async (token) => {
        if (token === "invalid") {
          throw new OAuthError(
            OAuthErrorCode.InvalidToken,
            "invalid test token"
          );
        }
        return {
          token,
          clientId: "test-client",
          scopes: token === "missing-scope" ? [] : ["tools:read"],
          expiresAt:
            token === "expired"
              ? Date.now() / 1000 - 60
              : Date.now() / 1000 + 60,
        };
      },
    },
    oauthMetadata: { issuer } as OAuthMetadata,
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: { sub: "user-1" },
      permissions: ["tools:read"],
    }),
  });
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://request-host.example.test${path}`, init);
}

describe("configureApp", () => {
  it("serves a custom GET route through getHandler()", async () => {
    const server = new MCPServer({
      name: "configure-app-test",
      version: "1.0.0",
      inspector: { enabled: false },
      configureApp: (app) => {
        app.get("/consent", (c) => c.text("consent-ok"));
      },
    });

    const handler = server.getHandler();
    const response = await handler(request("/consent"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("consent-ok");
  });

  it("does not apply the OAuth bearer gate to custom routes", async () => {
    const server = new MCPServer({
      name: "configure-app-oauth-test",
      version: "1.0.0",
      inspector: { enabled: false },
      oauth: provider({
        resource: "https://canonical.example.test/mcp",
        requiredScopes: ["tools:read"],
      }),
      configureApp: (app) => {
        app.get("/consent", (c) => c.text("public-consent"));
      },
    });

    const handler = server.getHandler();

    const custom = await handler(request("/consent"));
    expect(custom.status).toBe(200);
    expect(await custom.text()).toBe("public-consent");

    const mcp = await handler(request("/mcp", { method: "POST" }));
    expect(mcp.status).toBe(401);
  });

  it("invokes configureApp exactly once across repeated getHandler() calls", () => {
    const configureApp = vi.fn((_app: Hono) => undefined);

    const server = new MCPServer({
      name: "configure-app-once-test",
      version: "1.0.0",
      inspector: { enabled: false },
      configureApp,
    });

    server.getHandler();
    server.getHandler();
    server.getHandler();

    expect(configureApp).toHaveBeenCalledTimes(1);
  });

  it("throws TypeError when configureApp is not a function", () => {
    expect(
      () =>
        new MCPServer({
          name: "configure-app-invalid",
          version: "1.0.0",
          // @ts-expect-error — runtime validation for untyped call sites
          configureApp: "not-a-function",
        })
    ).toThrow(TypeError);
  });
});
