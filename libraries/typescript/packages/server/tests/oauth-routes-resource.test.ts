import { afterEach, describe, expect, it, vi } from "vitest";

import { MCPServer } from "../src/index.js";
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthAuthInfo,
  type OAuthMetadata,
  type RequestAuthOptions,
} from "../src/oauth/index.js";

const issuer = "https://issuer.example.test";
const originalMcpUrl = process.env["MCP_URL"];

afterEach(() => {
  vi.restoreAllMocks();
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
  it("delegates complete requests and engine challenges while exposing isolated typed identities", async () => {
    const resource = new URL("https://request-host.example.test/mcp");
    const engine = new MCPServer<{ id: string }>({
      name: "request-auth-test",
      version: "1.0.0",
      logging: { enabled: false },
      requestAuth: {
        resource,
        async authenticate(req) {
          if (!req.headers.has("DPoP")) {
            return new Response("engine challenge", {
              status: 401,
              headers: {
                "WWW-Authenticate": 'DPoP error="use_dpop_nonce"',
                "DPoP-Nonce": "engine-nonce",
              },
            });
          }
          // Authentication may inspect the JSON without consuming MCP's copy.
          expect(await req.json()).toMatchObject({ method: "tools/call" });
          return {
            token: req.headers.get("authorization")!,
            clientId: "client",
            scopes: ["tools:read"],
            expiresAt: Date.now() / 1000 + 60,
            resource,
          };
        },
        mapAuthInfo: (info) => ({
          user: { id: info.token },
          payload: {},
          permissions: info.scopes,
        }),
      },
    });
    engine.tool({ name: "whoami" }, (_params, ctx) => ({
      content: [{ type: "text", text: ctx.auth.user.id }],
    }));
    try {
      const denied = await engine.fetch(request("/mcp"));
      expect(denied.status).toBe(401);
      expect(challenge(denied)).toBe('DPoP error="use_dpop_nonce"');
      expect(denied.headers.get("DPoP-Nonce")).toBe("engine-nonce");
      expect(await denied.text()).toBe("engine challenge");
      for (const path of [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource/mcp",
      ]) {
        expect((await engine.fetch(request(path))).status).toBe(404);
      }
      const requests = ["alice", "bob"].map((identity) =>
        request("/mcp", {
          method: "POST",
          headers: {
            authorization: `DPoP ${identity}`,
            DPoP: `proof-${identity}`,
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
                  name: "test",
                  version: "1.0.0",
                },
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            },
          }),
        })
      );
      const responses = await Promise.all(
        requests.map((req) => engine.getHandler()(req))
      );
      for (const [index, response] of responses.entries()) {
        expect(response.status).toBe(200);
        // Check the body contract, not whether the verifier got a different object.
        expect(await requests[index]!.json()).toMatchObject({
          method: "tools/call",
          params: { name: "whoami" },
        });
        expect(await response.json()).toMatchObject({
          result: {
            content: [
              { type: "text", text: `DPoP ${index === 0 ? "alice" : "bob"}` },
            ],
          },
        });
      }
    } finally {
      await engine.close();
    }
  });

  it("fails closed on request authenticator errors and invalid success data", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resource = new URL("https://request-host.example.test/mcp");
    const valid: OAuthAuthInfo = {
      token: "token",
      clientId: "client",
      scopes: [],
      resource,
      expiresAt: Date.now() / 1000 + 60,
    };
    const mapAuthInfo = () => ({
      user: { id: "user" },
      payload: {},
      permissions: [],
    });
    const options: RequestAuthOptions<{ id: string }>[] = [
      {
        resource,
        mapAuthInfo,
        authenticate: async () => {
          throw new Error("private credentials");
        },
      },
      {
        resource,
        mapAuthInfo,
        authenticate: async () => ({ ...valid, expiresAt: 1 }),
      },
      {
        resource,
        mapAuthInfo,
        authenticate: async () => ({
          ...valid,
          resource: new URL("https://wrong.example/mcp"),
        }),
      },
      {
        resource,
        authenticate: async () => valid,
        mapAuthInfo: () => {
          throw new Error("private identity");
        },
      },
    ];
    for (const requestAuth of options) {
      const engine = new MCPServer({
        name: "invalid-auth",
        version: "1.0.0",
        requestAuth,
        logging: { enabled: false },
      });
      try {
        const response = await engine.fetch(request("/mcp"));
        expect(response.status).toBe(503);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: "temporarily_unavailable",
        });
      } finally {
        await engine.close();
      }
    }
    expect(warning.mock.calls.map((call) => call[1]?.stage)).toEqual([
      "authenticate",
      "validateAuthInfo",
      "validateAuthInfo",
      "mapAuthInfo",
    ]);
    const logs = JSON.stringify(warning.mock.calls);
    expect(logs).not.toMatch(/private credentials|private identity/);
    expect(logs).toContain(resource.href);
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
