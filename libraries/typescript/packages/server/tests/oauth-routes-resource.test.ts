import { afterEach, describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthMetadata,
  type OAuthProvider,
} from "../src/oauth/index.js";

const issuer = "https://issuer.example.test";
const originalMcpUrl = process.env["MCP_URL"];

afterEach(() => {
  if (originalMcpUrl === undefined) {
    delete process.env["MCP_URL"];
  } else {
    process.env["MCP_URL"] = originalMcpUrl;
  }
});

function provider(
  options: {
    resource?: string;
    requiredScopes?: readonly string[];
    scopesSupported?: readonly string[];
  } = {}
) {
  return oauthCustomProvider({
    ...options,
    createTokenVerifier: (resource) => ({
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
          resource,
        };
      },
    }),
    oauthMetadata: { issuer } as OAuthMetadata,
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: { sub: "user-1" },
      permissions: ["tools:read"],
    }),
  });
}

function server(
  options: {
    basePath?: string;
    resource?: string;
    requiredScopes?: readonly string[];
    scopesSupported?: readonly string[];
  } = {}
) {
  return new MCPServer({
    name: "oauth-route-test",
    version: "1.0.0",
    ...(options.basePath !== undefined && { basePath: options.basePath }),
    oauth: provider(options),
  });
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://request-host.example.test${path}`, init);
}

function challenge(response: Response): string {
  const value = response.headers.get("www-authenticate");
  expect(value).not.toBeNull();
  return value!;
}

describe("OAuth HTTP route acceptance", () => {
  it("creates one token verifier for the mounted OAuth provider", async () => {
    let verifierCreations = 0;
    const structuralProvider = {
      resource: "https://canonical.example.test/mcp",
      createTokenVerifier: (resource: URL) => {
        verifierCreations += 1;
        return {
          verifyAccessToken: async (token: string) => ({
            token,
            clientId: "test-client",
            scopes: ["tools:read"],
            expiresAt: Date.now() / 1000 + 60,
            resource,
          }),
        };
      },
      oauthMetadata: { issuer } as OAuthMetadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: { sub: "user-1" },
        permissions: ["tools:read"],
      }),
    };
    const oauthServer = new MCPServer({
      name: "oauth-binding-test",
      version: "1.0.0",
      oauth: structuralProvider,
    });

    expect(verifierCreations).toBe(0);

    const metadata = await oauthServer.fetch(
      request("/.well-known/oauth-protected-resource/mcp")
    );
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: "https://canonical.example.test/mcp",
      authorization_servers: [issuer],
    });

    for (const token of ["first-token", "second-token"]) {
      const response = await oauthServer.fetch(
        request("/mcp", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        })
      );
      expect(response.status).not.toBe(401);
    }
    expect(verifierCreations).toBe(1);
  });

  it("uses one immutable resource-bound provider binding for middleware, metadata, and auth", async () => {
    const order: string[] = [];
    const effectiveMetadata = {
      issuer: "https://bound-issuer.example.test",
      authorization_endpoint:
        "https://bound-issuer.example.test/oauth/authorize",
    } as OAuthMetadata;
    const effectiveRequiredScopes = ["bound:read"];
    const effectiveSupportedScopes = ["bound:read", "bound:write"];
    let bindCalls = 0;
    let boundResource: URL | undefined;
    let observedAuth:
      | {
          user: { id: string };
          payload: Record<string, unknown>;
          permissions: string[];
        }
      | undefined;

    const resourceBoundProvider: OAuthProvider<{ id: string }> = {
      resource: "https://canonical.example.test/mcp",
      bind: (resource) => {
        bindCalls += 1;
        boundResource = new URL(resource);
        resource.hostname = "mutated-by-provider.example.test";
        return {
          oauthMetadata: effectiveMetadata,
          tokenVerifier: {
            verifyAccessToken: async (token) => ({
              token,
              clientId: "bound-client",
              scopes: ["bound:read"],
              expiresAt: Date.now() / 1000 + 60,
              resource: boundResource!,
              extra: { upstream: true },
            }),
          },
          mapAuthInfo: (authInfo) => ({
            user: { id: `bound:${authInfo.clientId}` },
            payload: { token: authInfo.token },
            permissions: ["bound:permission"],
          }),
          requiredScopes: effectiveRequiredScopes,
          scopesSupported: effectiveSupportedScopes,
          resourceName: "Bound OAuth server",
          serviceDocumentationUrl: new URL(
            "https://bound-issuer.example.test/docs"
          ),
          middleware: async (request, next) => {
            const path = new URL(request.url).pathname;
            order.push(`provider:before:${path}`);
            if (path === "/oauth/local") {
              order.push("provider:handled");
              return Response.json({ issuer: effectiveMetadata.issuer });
            }
            const response = await next();
            order.push(`provider:after:${path}`);
            return response;
          },
        };
      },
    };
    const oauthServer = new MCPServer({
      name: "resource-bound-oauth-test",
      version: "1.0.0",
      logging: { enabled: false },
      allowedOrigins: ["https://allowed.example.test"],
      oauth: resourceBoundProvider,
    });
    oauthServer.use("*", async (_context, next) => {
      order.push("user:before");
      await next();
      order.push("user:after");
    });
    oauthServer.get("/unrelated", (context) => context.text("unrelated"));
    oauthServer.tool({ name: "whoami" }, async (_params, context) => {
      observedAuth = {
        user: context.auth.user,
        payload: context.auth.payload,
        permissions: [...context.auth.permissions],
      };
      return { content: [{ type: "text", text: context.auth.user.id }] };
    });

    const blocked = await oauthServer.fetch(
      request("/oauth/local", {
        method: "POST",
        headers: { origin: "https://blocked.example.test" },
      })
    );
    expect(blocked.status).toBe(403);
    expect(order).toEqual([]);

    const owned = await oauthServer.fetch(request("/oauth/local"));
    expect(owned.status).toBe(200);
    expect(await owned.json()).toEqual({
      issuer: "https://bound-issuer.example.test",
    });
    expect(order).toEqual(["provider:before:/oauth/local", "provider:handled"]);
    expect(bindCalls).toBe(1);
    expect(boundResource?.href).toBe("https://canonical.example.test/mcp");

    effectiveMetadata.issuer = "https://mutated.example.test";
    effectiveRequiredScopes.push("mutated:scope");
    effectiveSupportedScopes.push("mutated:scope");

    order.length = 0;
    const metadata = await oauthServer.fetch(
      request("/.well-known/oauth-protected-resource/mcp")
    );
    expect(await metadata.json()).toMatchObject({
      resource: "https://canonical.example.test/mcp",
      authorization_servers: ["https://bound-issuer.example.test"],
      scopes_supported: ["bound:read", "bound:write"],
      resource_name: "Bound OAuth server",
    });
    const authorizationMetadata = await oauthServer.fetch(
      request("/.well-known/oauth-authorization-server")
    );
    expect(await authorizationMetadata.json()).toMatchObject({
      issuer: "https://bound-issuer.example.test",
      authorization_endpoint:
        "https://bound-issuer.example.test/oauth/authorize",
    });
    expect(order).toEqual([]);

    const unrelated = await oauthServer.fetch(request("/unrelated"));
    expect(await unrelated.text()).toBe("unrelated");
    expect(order).toEqual([
      "provider:before:/unrelated",
      "user:before",
      "user:after",
      "provider:after:/unrelated",
    ]);

    order.length = 0;
    const unauthorized = await oauthServer.fetch(
      request("/mcp", { method: "POST" })
    );
    expect(unauthorized.status).toBe(401);
    expect(order).toEqual(["provider:before:/mcp", "provider:after:/mcp"]);

    order.length = 0;
    const authenticated = await oauthServer.fetch(
      request("/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer bound-token",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "whoami",
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
              "io.modelcontextprotocol/clientInfo": {
                name: "bound-provider-test",
                version: "1.0.0",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      })
    );
    expect(authenticated.status).toBe(200);
    expect(observedAuth).toEqual({
      user: { id: "bound:bound-client" },
      payload: { token: "bound-token" },
      permissions: ["bound:permission"],
    });
    expect(bindCalls).toBe(1);
  });

  it("rejects invalid resource-bound provider bindings at mount", async () => {
    const validBinding = () => ({
      oauthMetadata: {
        issuer: "https://bound-issuer.example.test",
      } as OAuthMetadata,
      tokenVerifier: {
        verifyAccessToken: async () => ({
          token: "token",
          clientId: "client",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource: new URL("https://canonical.example.test/mcp"),
        }),
      },
      mapAuthInfo: () => ({
        user: { id: "user" },
        payload: {},
        permissions: [],
      }),
    });
    const invalidBindings: Array<[string, unknown]> = [
      ["bind must return an object", null],
      ["oauthMetadata", { ...validBinding(), oauthMetadata: {} }],
      ["OAuthTokenVerifier", { ...validBinding(), tokenVerifier: {} }],
      ["mapAuthInfo", { ...validBinding(), mapAuthInfo: undefined }],
      ["requiredScopes", { ...validBinding(), requiredScopes: [123] }],
      ["resourceName", { ...validBinding(), resourceName: "   " }],
      [
        "serviceDocumentationUrl",
        {
          ...validBinding(),
          serviceDocumentationUrl: "https://example.test/docs",
        },
      ],
      ["middleware", { ...validBinding(), middleware: {} }],
    ];

    for (const [message, binding] of invalidBindings) {
      const invalidProvider: OAuthProvider<{ id: string }> = {
        resource: "https://canonical.example.test/mcp",
        bind: () => binding as never,
      };
      const invalidServer = new MCPServer({
        name: "invalid-bound-provider",
        version: "1.0.0",
        oauth: invalidProvider,
      });
      await expect(
        invalidServer.fetch(
          request("/.well-known/oauth-protected-resource/mcp")
        )
      ).rejects.toThrow(message);
    }
  });

  it("returns OAuth wire errors and a canonical path-aware challenge", async () => {
    const handler = server({
      basePath: "/api/mcp",
      resource: "https://canonical.example.test/api/mcp",
      requiredScopes: ["tools:read"],
    }).fetch;
    const resourceMetadata =
      "https://canonical.example.test/.well-known/oauth-protected-resource/api/mcp";

    for (const authorization of [undefined, "Basic credentials", "Bearer"]) {
      const response = await handler(
        request("/api/mcp", {
          method: "POST",
          headers: authorization === undefined ? {} : { authorization },
        })
      );
      expect(response.status).toBe(401);
      expect(challenge(response)).toContain('error="invalid_token"');
      expect(challenge(response)).toContain(
        `resource_metadata="${resourceMetadata}"`
      );
    }

    for (const token of ["expired", "invalid"]) {
      const response = await handler(
        request("/api/mcp", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        })
      );
      expect(response.status).toBe(401);
      expect(challenge(response)).toContain('error="invalid_token"');
      expect(challenge(response)).toContain(
        `resource_metadata="${resourceMetadata}"`
      );
    }

    const insufficientScope = await handler(
      request("/api/mcp", {
        method: "POST",
        headers: { authorization: "Bearer missing-scope" },
      })
    );
    expect(insufficientScope.status).toBe(403);
    expect(challenge(insufficientScope)).toContain(
      'error="insufficient_scope"'
    );
    expect(challenge(insufficientScope)).toContain(
      `resource_metadata="${resourceMetadata}"`
    );
  });

  it("keeps discovery public and gates only the exact MCP endpoint", async () => {
    const handler = server({
      basePath: "/api/mcp",
      resource: "https://canonical.example.test/api/mcp",
      scopesSupported: ["tools:read"],
    }).fetch;
    const protectedMetadata = "/.well-known/oauth-protected-resource/api/mcp";
    const authorizationMetadata = "/.well-known/oauth-authorization-server";

    for (const path of [protectedMetadata, authorizationMetadata]) {
      const get = await handler(request(path));
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type")).toContain("application/json");

      const head = await handler(request(path, { method: "HEAD" }));
      expect(head.status).toBe(200);

      const options = await handler(request(path, { method: "OPTIONS" }));
      expect(options.status).toBeLessThan(400);
    }

    const metadata = await handler(request(protectedMetadata));
    expect(await metadata.json()).toMatchObject({
      resource: "https://canonical.example.test/api/mcp",
      authorization_servers: [issuer],
      scopes_supported: ["tools:read"],
    });

    expect((await handler(request("/unrelated"))).status).toBe(404);
    expect((await handler(request("/api/mcp"))).status).toBe(401);
    expect((await handler(request("/api/mcp/inspector"))).status).toBe(404);
    expect((await handler(request("/api/mcp-sibling"))).status).not.toBe(401);
  });

  it("uses explicit resource before MCP_URL and never request Host", async () => {
    process.env["MCP_URL"] = "https://env.example.test";
    const explicitHandler = server({
      resource: "https://explicit.example.test/mcp",
    }).fetch;
    const explicitResponse = await explicitHandler(
      request("/mcp", { headers: { host: "attacker.example.test" } })
    );
    expect(challenge(explicitResponse)).toContain(
      'resource_metadata="https://explicit.example.test/.well-known/oauth-protected-resource/mcp"'
    );

    process.env["MCP_URL"] = "https://configured.example.test/";
    const configuredServer = server({ basePath: "/api/mcp" });
    process.env["MCP_URL"] = "https://changed-after-construction.example.test";
    const configuredHandler = configuredServer.fetch;
    const configuredResponse = await configuredHandler(
      request("/api/mcp", { headers: { host: "other.example.test" } })
    );
    expect(challenge(configuredResponse)).toContain(
      'resource_metadata="https://configured.example.test/.well-known/oauth-protected-resource/api/mcp"'
    );
  });

  it("validates configured resources during construction", () => {
    delete process.env["MCP_URL"];
    expect(() =>
      server({ resource: "https://canonical.example.test/not-mcp" })
    ).toThrow("must exactly match basePath");

    for (const mcpUrl of [
      "https://configured.example.test/prefix",
      "https://configured.example.test/?query=1",
      "https://configured.example.test/#fragment",
      "https://user:password@configured.example.test",
    ]) {
      process.env["MCP_URL"] = mcpUrl;
      expect(() => server()).toThrow();
    }
  });

  it("allows no configured resource for localhost listen but not server.fetch", async () => {
    delete process.env["MCP_URL"];
    await expect(
      server().fetch(new Request("http://edge.example/mcp"))
    ).rejects.toThrow("OAuth requires an explicit resource or MCP_URL");
    expect(() => server()).not.toThrow();
  });

  it("validates canonical resources and normalizes matching trailing slashes", async () => {
    for (const resource of [
      "http://public.example.test/mcp",
      "ftp://localhost/mcp",
      "https://user:password@example.test/mcp",
      "https://canonical.example.test/mcp?query=1",
      "https://canonical.example.test/mcp#fragment",
      "https://canonical.example.test/not-mcp",
    ]) {
      expect(() => server({ resource })).toThrow();
    }

    for (const resource of [
      "http://localhost/mcp/",
      "http://127.0.0.1/mcp/",
      "http://[::1]/mcp/",
    ]) {
      const handler = server({ resource }).fetch;
      const response = await handler(request("/mcp"));
      expect(challenge(response)).toContain('resource_metadata="http://');
    }

    const handler = server({
      basePath: "/api/mcp",
      resource: "https://canonical.example.test/api/mcp/",
    }).fetch;
    const metadata = await handler(
      request("/.well-known/oauth-protected-resource/api/mcp")
    );
    expect(metadata.status).toBe(200);
    const metadataJson = await metadata.json();
    expect(metadataJson).toMatchObject({
      resource: "https://canonical.example.test/api/mcp",
    });

    const mcpResponse = await handler(request("/api/mcp", { method: "POST" }));
    expect(mcpResponse.status).toBe(401);
    expect(challenge(mcpResponse)).toContain('error="invalid_token"');
  });

  it("derives a usable canonical resource for ephemeral localhost listen()", async () => {
    delete process.env["MCP_URL"];
    const oauthServer = server();
    const started = await oauthServer.listen(0);
    try {
      expect(started.url).toMatch(/^http:\/\/localhost:\d+\/mcp$/);
      const origin = new URL(started.url).origin;
      const metadata = await fetch(
        `${origin}/.well-known/oauth-protected-resource/mcp`
      );
      expect(metadata.status).toBe(200);
      expect(await metadata.json()).toMatchObject({ resource: started.url });
    } finally {
      await oauthServer.close();
    }
  });
});
