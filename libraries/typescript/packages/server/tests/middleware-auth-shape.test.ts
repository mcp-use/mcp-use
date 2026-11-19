/**
 * `ctx.auth` inside `mcp:*` middleware and observers is the SDK `AuthInfo`.
 * The tool callback's projected `ctx.auth` must not overwrite it, even though
 * both are derived from the same per-request Hono context.
 */
import { describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthMetadata,
} from "../src/oauth/index.js";

const resource = "https://shop.example.test/mcp";

interface TestUser {
  id: string;
}

function provider() {
  return oauthCustomProvider<TestUser>({
    resource,
    requiredScopes: ["shop"],
    scopesSupported: ["shop"],
    createTokenVerifier: (boundResource) => ({
      verifyAccessToken: async (token) => {
        if (token === "invalid") {
          throw new OAuthError(OAuthErrorCode.InvalidToken, "bad token");
        }
        return {
          token,
          clientId: "client-1",
          scopes: ["shop"],
          expiresAt: Date.now() / 1000 + 600,
          resource: boundResource,
        };
      },
    }),
    oauthMetadata: { issuer: "https://issuer.example.test" } as OAuthMetadata,
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: {},
      permissions: [],
    }),
  });
}

function toolCall(): Request {
  return new Request(resource, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "whoami",
      authorization: "Bearer tok",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "whoami",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "t", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

describe("middleware ctx.auth shape", () => {
  it("keeps the SDK AuthInfo in middleware and observers after the tool callback ran", async () => {
    const server = new MCPServer({
      name: "auth",
      version: "1.0.0",
      oauth: provider(),
      logging: { enabled: false },
    });
    const seen: Record<string, unknown> = {};

    server.use("mcp:tools/call", async (ctx, next) => {
      seen["before"] = ctx.auth;
      const result = await next();
      seen["after"] = ctx.auth;
      return result;
    });
    server.on("mcp:tools/call:complete", (ctx) => {
      seen["complete"] = ctx.auth;
    });
    server.tool({ name: "whoami" }, async (_args, ctx) => ({
      content: [{ type: "text" as const, text: ctx.auth.user.id }],
    }));

    const response = await server.fetch(toolCall());
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("user-1");

    for (const key of ["before", "after", "complete"]) {
      const auth = seen[key] as Record<string, unknown> | undefined;
      expect(auth, key).toMatchObject({ token: "tok", clientId: "client-1" });
      expect(auth, key).not.toHaveProperty("accessToken");
    }
  });
  function authServer() {
    return new MCPServer({
      name: "auth",
      version: "1.0.0",
      oauth: provider(),
      logging: { enabled: false },
    });
  }

  it("keeps the middleware fields visible to spread and Object.keys", async () => {
    const server = authServer();
    let keys: string[] = [];
    server.use("mcp:tools/call", async (ctx, next) => {
      keys = Object.keys({ ...ctx });
      return next();
    });
    server.tool({ name: "whoami" }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));

    const response = await server.fetch(toolCall());
    expect(response.status).toBe(200);
    expect(keys).toEqual(
      expect.arrayContaining(["method", "params", "auth", "state"])
    );
  });

  it("forwards writes to existing Hono members instead of the overlay", async () => {
    const server = authServer();
    const replacement = new Response("replaced");
    let seenInCallback: unknown;
    server.use("mcp:tools/call", async (ctx, next) => {
      (ctx as unknown as { res: Response }).res = replacement;
      return next();
    });
    server.tool({ name: "whoami" }, async (_args, ctx) => {
      seenInCallback = (ctx as unknown as { res: Response }).res;
      return { content: [{ type: "text" as const, text: "ok" }] };
    });

    const response = await server.fetch(toolCall());
    expect(response.status).toBe(200);
    expect(seenInCallback).toBe(replacement);
  });
});
