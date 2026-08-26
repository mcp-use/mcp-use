import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
} from "@modelcontextprotocol/server";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  resolveConfiguredOAuthResource,
  wrapOAuthTokenVerifier,
} from "../src/oauth/internal.js";
import { createJwtVerifier } from "../src/oauth/jwt.js";
import { oauthCustomProvider } from "../src/oauth/provider.js";

const metadata = {
  issuer: "https://issuer.example.com",
} as OAuthMetadata;
const canonicalResource = new URL("https://api.example.test/mcp");

function createProvider(authInfo: AuthInfo) {
  return oauthCustomProvider({
    createTokenVerifier: () => ({
      verifyAccessToken: async () => authInfo,
    }),
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
      resource: canonicalResource,
      extra: { upstream: true },
    });

    await expect(
      wrapOAuthTokenVerifier(provider, canonicalResource).verifyAccessToken(
        "presented-token"
      )
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
      wrapOAuthTokenVerifier(provider, canonicalResource).verifyAccessToken(
        "presented-token"
      )
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
  });

  it("binds a returned token resource to the resolved canonical resource", async () => {
    const expectedResource = resolveConfiguredOAuthResource({
      provider: createProvider({
        token: "verified-token",
        clientId: "client-1",
        scopes: [],
        expiresAt: Date.now() / 1000 + 60,
      }),
      basePath: "/mcp",
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
        expectedResource!
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
        expectedResource!
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    await expect(
      wrapOAuthTokenVerifier(
        createProvider(authInfo),
        expectedResource!
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
      message: "Token verifier did not return a validated protected resource",
    });
    await expect(
      wrapOAuthTokenVerifier(
        createProvider({
          ...authInfo,
          resource: new URL("https://other.example.test/mcp"),
        }),
        expectedResource!
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
          expectedResource!
        ).verifyAccessToken("presented-token")
      ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    }
  });

  it("accepts JWTs whose audience is the protected resource", async () => {
    const key = new TextEncoder().encode(
      "a sufficiently long test signing key"
    );
    const audience = "https://api.example.test/mcp";
    const expectedResource = new URL(audience);
    const issuer = "https://issuer.example.test";
    const verifier = createJwtVerifier({
      issuer,
      jwksUrl: new URL(`${issuer}/.well-known/jwks.json`),
      key,
      algorithms: ["HS256"],
      resource: expectedResource,
    });
    const provider = oauthCustomProvider({
      createTokenVerifier: () => verifier,
      oauthMetadata: metadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: { sub: "user-1" },
        permissions: ["tools:read"],
      }),
    });
    const token = await new SignJWT({ sub: "user-1", client_id: "client-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(key);

    const authInfo = await wrapOAuthTokenVerifier(
      provider,
      expectedResource
    ).verifyAccessToken(token);
    expect(authInfo).toMatchObject({
      clientId: "client-1",
      resource: expectedResource,
    });
  });

  it("accepts aud arrays or resource claims and rejects unbound JWTs", async () => {
    const key = new TextEncoder().encode(
      "a sufficiently long test signing key"
    );
    const issuer = "https://issuer.example.test";
    const verifier = createJwtVerifier({
      issuer,
      jwksUrl: new URL(`${issuer}/.well-known/jwks.json`),
      key,
      algorithms: ["HS256"],
      resource: canonicalResource,
    });
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT({ sub: "user-1", client_id: "client-1", ...claims })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(issuer)
        .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
        .sign(key);

    await expect(
      verifier.verifyAccessToken(
        await sign({ aud: ["provider-api", canonicalResource.href] })
      )
    ).resolves.toMatchObject({ resource: canonicalResource });
    await expect(
      verifier.verifyAccessToken(
        await sign({ resource: `${canonicalResource.href}/` })
      )
    ).resolves.toMatchObject({ resource: canonicalResource });

    for (const claims of [
      {},
      { aud: "provider-api" },
      { aud: 123 },
      { aud: canonicalResource.href, resource: "https://other.example/mcp" },
    ]) {
      await expect(
        verifier.verifyAccessToken(await sign(claims))
      ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    }
  });

  it("keeps provider audiences separate from the protected resource", async () => {
    const key = new TextEncoder().encode(
      "a sufficiently long test signing key"
    );
    const issuer = "https://issuer.example.test";
    const verifier = createJwtVerifier({
      issuer,
      jwksUrl: new URL(`${issuer}/.well-known/jwks.json`),
      key,
      algorithms: ["HS256"],
      resource: canonicalResource,
      audience: "provider-api",
    });
    const sign = (claims: Record<string, unknown>) =>
      new SignJWT({ sub: "user-1", client_id: "client-1", ...claims })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(issuer)
        .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
        .sign(key);

    await expect(
      verifier.verifyAccessToken(await sign({ aud: "provider-api" }))
    ).resolves.toMatchObject({ resource: canonicalResource });
    await expect(
      verifier.verifyAccessToken(await sign({ aud: "other-api" }))
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    await expect(
      verifier.verifyAccessToken(
        await sign({
          aud: "provider-api",
          resource: "https://other.example/mcp",
        })
      )
    ).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
      message: "Token resource claim does not match protected resource",
    });
  });

  it("rejects verifier output that does not prove resource binding", async () => {
    const expectedResource = new URL("https://api.example.test/mcp");
    const provider = createProvider({
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
      extra: { payload: { sub: "user-1" } },
    });

    await expect(
      wrapOAuthTokenVerifier(provider, expectedResource).verifyAccessToken(
        "presented-token"
      )
    ).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
      message: "Token verifier did not return a validated protected resource",
    });
  });

  it("does not let a custom verifier mutate the expected resource", async () => {
    const provider = oauthCustomProvider({
      createTokenVerifier: (resource) => {
        resource.hostname = "other.example.test";
        return {
          verifyAccessToken: async () => ({
            token: "verified-token",
            clientId: "client-1",
            scopes: [],
            expiresAt: Date.now() / 1000 + 60,
            resource,
          }),
        };
      },
      oauthMetadata: metadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: { sub: "user-1" },
        permissions: [],
      }),
    });

    await expect(
      wrapOAuthTokenVerifier(provider, canonicalResource).verifyAccessToken(
        "presented-token"
      )
    ).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
      message: "Token resource does not match the protected resource",
    });
    expect(canonicalResource.href).toBe("https://api.example.test/mcp");
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
      resource: canonicalResource,
    });
    const token = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://issuer.example.test")
      .setAudience(canonicalResource.href)
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
      resource: canonicalResource,
    });
    const token = await new SignJWT({ sub: "   " })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://issuer.example.test")
      .setAudience(canonicalResource.href)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(key);

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      clientId: "",
    });
  });

  it("converts mapper failures and malformed mapped data to invalid tokens", async () => {
    const mapperFailure = oauthCustomProvider({
      createTokenVerifier: () => ({
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource: canonicalResource,
        }),
      }),
      oauthMetadata: metadata,
      mapAuthInfo: () => {
        throw new Error("mapper failed");
      },
    });
    const malformedMapping = oauthCustomProvider({
      createTokenVerifier: () => ({
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource: canonicalResource,
        }),
      }),
      oauthMetadata: metadata,
      mapAuthInfo: () =>
        ({ user: { id: "user-1" }, payload: {}, permissions: [123] }) as never,
    });
    const malformedProviderToken = oauthCustomProvider({
      createTokenVerifier: () => ({
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource: canonicalResource,
        }),
      }),
      oauthMetadata: metadata,
      mapAuthInfo: () =>
        ({
          user: { id: "user-1" },
          payload: {},
          permissions: [],
          providerAccessToken: 123,
        }) as never,
    });

    await expect(
      wrapOAuthTokenVerifier(
        mapperFailure,
        canonicalResource
      ).verifyAccessToken("presented-token")
    ).rejects.toBeInstanceOf(OAuthError);
    await expect(
      wrapOAuthTokenVerifier(
        malformedMapping,
        canonicalResource
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
    await expect(
      wrapOAuthTokenVerifier(
        malformedProviderToken,
        canonicalResource
      ).verifyAccessToken("presented-token")
    ).rejects.toMatchObject({ code: OAuthErrorCode.InvalidToken });
  });

  it("leaves unexpected verifier failures untouched", async () => {
    const verifierFailure = new Error("verifier unavailable");
    const provider = oauthCustomProvider({
      createTokenVerifier: () => ({
        verifyAccessToken: async () => {
          throw verifierFailure;
        },
      }),
      oauthMetadata: metadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: {},
        permissions: [],
      }),
    });

    await expect(
      wrapOAuthTokenVerifier(provider, canonicalResource).verifyAccessToken(
        "presented-token"
      )
    ).rejects.toBe(verifierFailure);
  });

  it("validates supplied custom-provider options", () => {
    const validOptions = {
      createTokenVerifier: () => ({
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource: canonicalResource,
        }),
      }),
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
        createTokenVerifier: undefined as never,
      })
    ).toThrow("oauthCustomProvider requires createTokenVerifier");
    expect(() =>
      oauthCustomProvider({
        ...validOptions,
        resource: "ftp://localhost/mcp",
      })
    ).toThrow("resource must use HTTPS, or HTTP for localhost");
  });

  it("resolves an explicit canonical resource and rejects a path mismatch", () => {
    const provider = oauthCustomProvider({
      createTokenVerifier: () => ({
        verifyAccessToken: async () => ({
          token: "verified-token",
          clientId: "client-1",
          scopes: [],
          expiresAt: Date.now() / 1000 + 60,
          resource: canonicalResource,
        }),
      }),
      oauthMetadata: metadata,
      mapAuthInfo: () => ({
        user: { id: "user-1" },
        payload: {},
        permissions: [],
      }),
      resource: "https://api.example.com/api/mcp/",
    });

    expect(
      resolveConfiguredOAuthResource({
        provider,
        basePath: "/api/mcp",
      })?.href
    ).toBe("https://api.example.com/api/mcp");
    expect(() =>
      resolveConfiguredOAuthResource({
        provider,
        basePath: "/mcp",
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
        resolveConfiguredOAuthResource({
          provider,
          basePath: "/mcp",
          mcpUrl: origin,
        })?.href
      ).toBe(`${origin}/mcp`);
    }
    expect(() =>
      resolveConfiguredOAuthResource({
        provider,
        basePath: "/mcp",
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
        resolveConfiguredOAuthResource({
          provider,
          basePath: "/mcp",
          mcpUrl,
        })
      ).toThrow("must use HTTPS, or HTTP for localhost");
    }
  });

  it("returns undefined when no configured resource is available", () => {
    const provider = createProvider({
      token: "verified-token",
      clientId: "client-1",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
    });

    expect(
      resolveConfiguredOAuthResource({
        provider,
        basePath: "/mcp",
      })
    ).toBeUndefined();
  });
});
