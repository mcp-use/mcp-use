import { afterEach, describe, expect, it } from "vitest";

import { MCPServer } from "../src/index.js";
import {
  OAuthError,
  OAuthErrorCode,
  oauthCustomProvider,
  type OAuthMetadata,
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
