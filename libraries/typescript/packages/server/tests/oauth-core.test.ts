import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  resolveOAuthResource,
  wrapOAuthTokenVerifier,
} from "../src/oauth/internal.js";
import { createJwtVerifier } from "../src/oauth/jwt.js";
import { oauthCustomProvider } from "../src/oauth/provider.js";

const metadata = {
  issuer: "https://issuer.example.com",
} as OAuthMetadata;

function createProvider(authInfo: AuthInfo) {
  return oauthCustomProvider({
    tokenVerifier: {
      verifyAccessToken: async () => authInfo,
    },
    oauthMetadata: metadata,
    mapAuthInfo: () => ({
      user: { id: "user-1" },
      payload: { sub: "user-1" },
      permissions: ["tools:read"],
    }),
  });
}

describe("OAuth core", () => {
  it("merges verified mapped identity into SDK auth information", async () => {
    const provider = createProvider({
      token: "verified-token",
      clientId: "client-1",
      scopes: ["mcp"],
      expiresAt: Date.now() / 1000 + 60,
      extra: { upstream: true },
    });

    await expect(
      wrapOAuthTokenVerifier(provider).verifyAccessToken("presented-token")
    ).resolves.toMatchObject({
      token: "verified-token",
      clientId: "client-1",
      scopes: ["mcp"],
      extra: {
        upstream: true,
        user: { id: "user-1" },
        payload: { sub: "user-1" },
        permissions: ["tools:read"],
      },
    });
  });

  it("rejects incomplete verifier output as an invalid token", async () => {
    const provider = createProvider({
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Number.POSITIVE_INFINITY,
    });

    await expect(
      wrapOAuthTokenVerifier(provider).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
  });

  it("binds a returned token resource to the resolved canonical resource", async () => {
    const expectedResource = resolveOAuthResource({
      provider: createProvider({
        token: "verified-token",
        clientId: "client-1",
        scopes: [],
        expiresAt: Date.now() / 1000 + 60,
      }),
      basePath: "/mcp",
      mode: "handler",
      mcpUrl: "https://api.example.test",
    });
    const authInfo = {
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
    };

    await expect(
      wrapOAuthTokenVerifier(
        createProvider({
          ...authInfo,
          resource: new URL("https://api.example.test/mcp/"),
        }),
        expectedResource
      ).verifyAccessToken("presented-token")
    ).resolves.toMatchObject({
      resource: new URL("https://api.example.test/mcp/"),
    });
    await expect(
      wrapOAuthTokenVerifier(
        createProvider({
          ...authInfo,
          resource: "https://api.example.test/mcp" as never,
        }),
        expectedResource
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    await expect(
      wrapOAuthTokenVerifier(
        createProvider(authInfo),
        expectedResource
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    await expect(
      wrapOAuthTokenVerifier(
        createProvider({
          ...authInfo,
          resource: new URL("https://other.example.test/mcp"),
        }),
        expectedResource
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });

    for (const resource of [
      "not a URL",
      { toString: () => "https://api.example.test/mcp" },
      new URL("https://api.example.test/mcp?query=1"),
      new URL("https://api.example.test/mcp#fragment"),
      new URL("https://user@example.test/mcp"),
      new URL("http://api.example.test/mcp"),
    ]) {
      await expect(
        wrapOAuthTokenVerifier(
          createProvider({ ...authInfo, resource: resource as never }),
          expectedResource
        ).verifyAccessToken("presented-token")
      ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    }
  });

  it("validates returned token resources without an expected resource", async () => {
    const authInfo = {
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
    };

    await expect(
      wrapOAuthTokenVerifier(
        createProvider({
          ...authInfo,
          resource: new URL("https://api.example.test/mcp"),
        })
      ).verifyAccessToken("presented-token")
    ).resolves.toMatchObject({
      resource: new URL("https://api.example.test/mcp"),
    });
    await expect(
      wrapOAuthTokenVerifier(
        createProvider({
          ...authInfo,
          resource: new URL("https://api.example.test/mcp?query=1"),
        })
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
  });

  it("uses empty clientId when client_id and azp are absent", async () => {
    const key = new TextEncoder().encode(
      "a sufficiently long test signing key"
    );
    const verifier = createJwtVerifier({
      issuer: "https://issuer.example.test",
      jwksUrl: new URL("https://issuer.example.test/.well-known/jwks.json"),
      key,
      algorithms: ["HS256"],
    });
    const token = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://issuer.example.test")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(key);

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      clientId: "",
    });
  });

  it("verifies JWTs with blank client identity claims using empty clientId", async () => {
    const key = new TextEncoder().encode(
      "a sufficiently long test signing key"
    );
    const verifier = createJwtVerifier({
      issuer: "https://issuer.example.test",
      jwksUrl: new URL("https://issuer.example.test/.well-known/jwks.json"),
      key,
      algorithms: ["HS256"],
    });
    const token = await new SignJWT({ sub: "   " })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://issuer.example.test")
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(key);

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      clientId: "",
    });
  });

  it("converts mapper failures and malformed mapped data to invalid tokens", async () => {
    const mapperFailure = oauthCustomProvider({
      tokenVerifier: {
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
        }),
      },
      oauthMetadata: metadata,
      mapAuthInfo: () => {
        throw new Error("mapper failed");
      },
    });
    const malformedMapping = oauthCustomProvider({
      tokenVerifier: {
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
        }),
      },
      oauthMetadata: metadata,
      mapAuthInfo: () =>
        ({ user: { id: "user-1" }, payload: {}, permissions: [123] }) as never,
    });

    await expect(
      wrapOAuthTokenVerifier(mapperFailure).verifyAccessToken("presented-token")
    ).rejects.toBeInstanceOf(OAuthError);
    await expect(
      wrapOAuthTokenVerifier(malformedMapping).verifyAccessToken(
        "presented-token"
      )
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
  });

  it("leaves unexpected verifier failures untouched", async () => {
    const verifierFailure = new Error("verifier unavailable");
    const provider = oauthCustomProvider({
      tokenVerifier: {
        verifyAccessToken: async () => {
          throw verifierFailure;
        },
      },
      oauthMetadata: metadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: {},
        permissions: [],
      }),
    });

    await expect(
      wrapOAuthTokenVerifier(provider).verifyAccessToken("presented-token")
    ).rejects.toBe(verifierFailure);
  });

  it("validates supplied custom-provider options", () => {
    const validOptions = {
      tokenVerifier: {
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
        }),
      },
      oauthMetadata: metadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: {},
        permissions: [],
      }),
    };

    expect(() =>
      oauthCustomProvider({
        ...validOptions,
        requiredScopes: ["read", 1] as never,
      })
    ).toThrow("requiredScopes must be an array of strings");
    expect(() =>
      oauthCustomProvider({
        ...validOptions,
        scopesSupported: "read" as never,
      })
    ).toThrow("scopesSupported must be an array of strings");
    expect(() =>
      oauthCustomProvider({ ...validOptions, resourceName: "   " })
    ).toThrow("resourceName must be a non-empty string");
    expect(() =>
      oauthCustomProvider({
        ...validOptions,
        serviceDocumentationUrl: new URL("ftp://localhost/docs"),
      })
    ).toThrow("serviceDocumentationUrl must use HTTPS, or HTTP for localhost");
    expect(() =>
      oauthCustomProvider({
        ...validOptions,
        oauthMetadata: {} as OAuthMetadata,
      })
    ).toThrow("oauthMetadata must include a string issuer");
    expect(() =>
      oauthCustomProvider({
        ...validOptions,
        tokenVerifier: {} as never,
      })
    ).toThrow("oauthCustomProvider requires tokenVerifier");
    expect(() =>
      oauthCustomProvider({
        ...validOptions,
        resource: "ftp://localhost/mcp",
      })
    ).toThrow("resource must use HTTPS, or HTTP for localhost");
  });

  it("resolves an explicit canonical resource and rejects a path mismatch", () => {
    const provider = oauthCustomProvider({
      tokenVerifier: {
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
        }),
      },
      oauthMetadata: metadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: {},
        permissions: [],
      }),
      resource: "https://api.example.com/api/mcp/",
    });

    expect(
      resolveOAuthResource({
        provider,
        basePath: "/api/mcp",
        mode: "handler",
      }).href
    ).toBe("https://api.example.com/api/mcp");
    expect(() =>
      resolveOAuthResource({
        provider,
        basePath: "/mcp",
        mode: "handler",
      })
    ).toThrow("must exactly match basePath");
  });

  it("accepts HTTP only for actual localhost and loopback hostnames", () => {
    const provider = createProvider({
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
    });

    for (const origin of [
      "http://localhost",
      "http://api.localhost",
      "http://127.0.0.1",
      "http://[::1]",
    ]) {
      expect(
        resolveOAuthResource({
          provider,
          basePath: "/mcp",
          mode: "handler",
          mcpUrl: origin,
        }).href
      ).toBe(`${origin}/mcp`);
    }
    expect(() =>
      resolveOAuthResource({
        provider,
        basePath: "/mcp",
        mode: "handler",
        mcpUrl: "http://evil-localhost",
      })
    ).toThrow("must use HTTPS, or HTTP for localhost");
  });

  it("rejects non-HTTP(S) and public HTTP configured origins", () => {
    const provider = createProvider({
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
    });

    for (const mcpUrl of ["ftp://localhost", "http://api.example.com"]) {
      expect(() =>
        resolveOAuthResource({
          provider,
          basePath: "/mcp",
          mode: "handler",
          mcpUrl,
        })
      ).toThrow("must use HTTPS, or HTTP for localhost");
    }
  });

  it("requires an explicit resource or MCP_URL in handler mode", () => {
    const provider = createProvider({
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
    });
    const originalMcpUrl = process.env["MCP_URL"];

    try {
      delete process.env["MCP_URL"];
      expect(() =>
        resolveOAuthResource({
          provider,
          basePath: "/mcp",
          mode: "handler",
        })
      ).toThrow("requires an explicit resource or MCP_URL");
    } finally {
      if (originalMcpUrl === undefined) {
        delete process.env["MCP_URL"];
      } else {
        process.env["MCP_URL"] = originalMcpUrl;
      }
    }
  });
});
