import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { oauthAuth0Provider } from "../src/oauth/auth0.js";
import { oauthBetterAuthProvider } from "../src/oauth/better-auth.js";
import { oauthConvexProvider } from "../src/oauth/convex.js";
import { oauthClerkProvider } from "../src/oauth/clerk.js";
import { wrapOAuthTokenVerifier } from "../src/oauth/internal.js";
import { oauthKeycloakProvider } from "../src/oauth/keycloak.js";
import { oauthScalekitProvider } from "../src/oauth/scalekit.js";
import { oauthSupabaseProvider } from "../src/oauth/supabase.js";
import { oauthWorkOSProvider } from "../src/oauth/workos.js";

const now = () => Math.floor(Date.now() / 1000);
const originalFetch = globalThis.fetch;
const protectedResource = new URL("https://api.example.test/mcp");

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("direct OAuth providers", () => {
  it("restores the v1 zero-config provider environment contract", () => {
    vi.stubEnv("MCP_USE_OAUTH_AUTH0_DOMAIN", "env.auth0.example");
    vi.stubEnv("MCP_USE_OAUTH_AUTH0_AUDIENCE", "https://api.example.test/mcp");
    vi.stubEnv(
      "MCP_USE_OAUTH_KEYCLOAK_SERVER_URL",
      "https://keycloak.example.test"
    );
    vi.stubEnv("MCP_USE_OAUTH_KEYCLOAK_REALM", "env-realm");
    vi.stubEnv(
      "MCP_USE_OAUTH_KEYCLOAK_AUDIENCE",
      "https://keycloak-api.example.test/mcp"
    );
    vi.stubEnv(
      "MCP_USE_OAUTH_CLERK_FRONTEND_API_URL",
      "https://env.clerk.accounts.dev"
    );
    vi.stubEnv("MCP_USE_OAUTH_WORKOS_SUBDOMAIN", "env-company.authkit.app");
    vi.stubEnv(
      "MCP_USE_OAUTH_BETTER_AUTH_URL",
      "https://auth.example.test/api/auth"
    );
    vi.stubEnv("MCP_USE_OAUTH_SUPABASE_PROJECT_ID", "env-project");
    vi.stubEnv(
      "MCP_USE_OAUTH_SUPABASE_JWT_SECRET",
      "0123456789abcdef0123456789abcdef"
    );
    vi.stubEnv(
      "MCP_USE_OAUTH_SCALEKIT_ENVIRONMENT_URL",
      "https://env.scalekit.example"
    );
    vi.stubEnv("MCP_USE_OAUTH_SCALEKIT_RESOURCE_ID", "res_env");

    expect(oauthAuth0Provider()).toMatchObject({
      resource: "https://api.example.test/mcp",
      oauthMetadata: { issuer: "https://env.auth0.example/" },
    });
    expect(oauthKeycloakProvider()).toMatchObject({
      resource: "https://keycloak-api.example.test/mcp",
      oauthMetadata: {
        issuer: "https://keycloak.example.test/realms/env-realm",
      },
    });
    expect(oauthClerkProvider().oauthMetadata.issuer).toBe(
      "https://env.clerk.accounts.dev"
    );
    expect(oauthWorkOSProvider().oauthMetadata.issuer).toBe(
      "https://env-company.authkit.app"
    );
    expect(oauthBetterAuthProvider().oauthMetadata.issuer).toBe(
      "https://auth.example.test/api/auth"
    );
    expect(oauthSupabaseProvider().oauthMetadata.issuer).toBe(
      "https://env-project.supabase.co/auth/v1"
    );
    expect(oauthScalekitProvider().oauthMetadata.issuer).toBe(
      "https://env.scalekit.example/resources/res_env"
    );
  });

  it("keeps explicit provider config ahead of v1 environment fallbacks", () => {
    vi.stubEnv("MCP_USE_OAUTH_AUTH0_DOMAIN", "env.auth0.example");
    vi.stubEnv(
      "MCP_USE_OAUTH_AUTH0_AUDIENCE",
      "https://env-api.example.test/mcp"
    );
    vi.stubEnv("MCP_USE_OAUTH_SUPABASE_PROJECT_ID", "env-project");
    vi.stubEnv("MCP_USE_OAUTH_SUPABASE_URL", "https://env-project.supabase.co");

    expect(
      oauthAuth0Provider({
        domain: "explicit.auth0.example",
        resource: "https://explicit-api.example.test/mcp",
      })
    ).toMatchObject({
      resource: "https://explicit-api.example.test/mcp",
      oauthMetadata: { issuer: "https://explicit.auth0.example/" },
    });
    expect(
      oauthSupabaseProvider({
        projectId: "explicit-project",
        supabaseUrl: "http://localhost:54321",
      }).oauthMetadata.issuer
    ).toBe("http://localhost:54321/auth/v1");
  });

  it("verifies Better Auth JWTs and preserves issuer path prefixes", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "better-auth-key";
    globalThis.fetch = jwksFixture(jwk);

    const issuer = "https://auth.example.test/platform/api/auth";
    const provider = oauthBetterAuthProvider({ authURL: `${issuer}/` });
    expect(provider.oauthMetadata).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      registration_endpoint: `${issuer}/oauth2/register`,
      jwks_uri: `${issuer}/jwks`,
      code_challenge_methods_supported: ["S256"],
    });

    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        await signedToken(
          privateKey,
          "better-auth-key",
          issuer,
          protectedResource.href,
          {
            sub: "anonymous-user-1",
            azp: "mcp-client-1",
            scope: "openid tools:read",
            name: "Anonymous",
            is_anonymous: true,
            roles: ["guest"],
            permissions: ["tools:read"],
            sid: "session-1",
          },
          "EdDSA"
        )
      )
    ).resolves.toMatchObject({
      clientId: "mcp-client-1",
      scopes: ["openid", "tools:read"],
      extra: {
        user: {
          id: "anonymous-user-1",
          name: "Anonymous",
          isAnonymous: true,
          roles: ["guest"],
          sessionId: "session-1",
        },
        permissions: ["tools:read"],
      },
    });
  });

  it("verifies Convex JWTs and keeps the mounted oauth base path", async () => {
    const { privateKey, publicKey } = await generateKeyPair("EdDSA");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "convex-key";
    globalThis.fetch = jwksFixture(jwk);

    // Convex mounts the component under a base path and issues tokens whose
    // `iss` includes it, so the whole URL is the issuer.
    const issuer = "https://example.convex.site/oauth";
    const provider = oauthConvexProvider({ authURL: `${issuer}/` });
    expect(provider.oauthMetadata).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      code_challenge_methods_supported: ["S256"],
    });

    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        await signedToken(
          privateKey,
          "convex-key",
          issuer,
          protectedResource.href,
          {
            sub: "convex-user-1",
            cid: "mcp-client-1",
            scope: "openid email",
            scp: ["openid", "email"],
            email: "user@example.test",
            email_verified: true,
            name: "Convex User",
          },
          "EdDSA"
        )
      )
    ).resolves.toMatchObject({
      scopes: ["openid", "email"],
      extra: {
        user: {
          id: "convex-user-1",
          email: "user@example.test",
          emailVerified: true,
          name: "Convex User",
          clientId: "mcp-client-1",
        },
        permissions: ["openid", "email"],
      },
    });
  });

  it("validates Better Auth authURL and token audience", async () => {
    expect(() =>
      oauthBetterAuthProvider({ authURL: "http://auth.example.test/api/auth" })
    ).toThrow(/HTTPS|localhost/);

    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "better-auth-key";
    globalThis.fetch = jwksFixture(jwk);
    const issuer = "http://localhost:3000/api/auth";
    const provider = oauthBetterAuthProvider({ authURL: issuer });
    const token = await signedToken(
      privateKey,
      "better-auth-key",
      issuer,
      "http://localhost:3000/other",
      { sub: "user-1", azp: "client-1" }
    );

    await expect(
      provider.createTokenVerifier(protectedResource).verifyAccessToken(token)
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("verifies Auth0 JWTs with cached remote JWKS and maps claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "test-key";
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" },
      });
    };

    const provider = oauthAuth0Provider({
      domain: "issuer.example.test",
      resource: "https://api.example.test/mcp",
    });
    const sign = (claims: Record<string, unknown> = {}) =>
      new SignJWT({
        sub: "auth0|user-1",
        client_id: "client-1",
        scope: "mcp tools:read",
        email: "user@example.test",
        updated_at: "2026-01-02T03:04:05.000Z",
        roles: ["admin"],
        permissions: ["tools:read"],
        resource: "https://api.example.test/mcp",
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer("https://issuer.example.test/")
        .setAudience("https://api.example.test/mcp")
        .setIssuedAt(now())
        .setExpirationTime(now() + 60)
        .sign(privateKey);

    const verifier = wrapOAuthTokenVerifier(provider, protectedResource);
    const token = await sign();
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      clientId: "client-1",
      scopes: ["mcp", "tools:read"],
      resource: new URL("https://api.example.test/mcp"),
      extra: {
        user: {
          id: "auth0|user-1",
          email: "user@example.test",
          updatedAt: "2026-01-02T03:04:05.000Z",
          roles: ["admin"],
        },
        permissions: ["tools:read"],
      },
    });
    await verifier.verifyAccessToken(await sign());
    expect(requests).toBe(1);

    await expect(
      verifier.verifyAccessToken(
        await sign({ resource: "https://other.example/mcp" })
      )
    ).rejects.toMatchObject({ code: "invalid_token" });
    await expect(
      verifier.verifyAccessToken(
        await new SignJWT({ sub: "user", client_id: "client" })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuer("https://issuer.example.test/")
          .setAudience("https://api.example.test/mcp")
          .setExpirationTime(now() + 60)
          .sign(
            new TextEncoder().encode("a sufficiently long test signing key")
          )
      )
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("rejects Supabase issuer, audience, and expired tokens", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const provider = oauthSupabaseProvider({
      projectId: "example-project",
      jwtSecret: secret,
    });
    const verifier = provider.createTokenVerifier(protectedResource);
    const token = (
      issuer: string,
      audience: string,
      exp: number,
      claims: Record<string, unknown> = {}
    ) =>
      new SignJWT({ sub: "user-1", client_id: "client-1", ...claims })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime(exp)
        .sign(new TextEncoder().encode(secret));

    await expect(
      verifier.verifyAccessToken(
        await token(
          "https://example-project.supabase.co/auth/v1",
          "authenticated",
          now() + 60
        )
      )
    ).resolves.toMatchObject({ clientId: "client-1" });
    const invalidTokens: readonly [string, string, number][] = [
      ["https://other.supabase.co/auth/v1", "authenticated", now() + 60],
      ["https://example-project.supabase.co/auth/v1", "other", now() + 60],
      [
        "https://example-project.supabase.co/auth/v1",
        "authenticated",
        now() - 1,
      ],
    ];
    for (const [issuer, audience, exp] of invalidTokens) {
      await expect(
        verifier.verifyAccessToken(await token(issuer, audience, exp))
      ).rejects.toMatchObject({
        code: "invalid_token",
      });
    }
    await expect(
      verifier.verifyAccessToken(
        await token(
          "https://example-project.supabase.co/auth/v1",
          "authenticated",
          now() + 60,
          { resource: "https://other.example/mcp" }
        )
      )
    ).rejects.toMatchObject({
      code: "invalid_token",
      message: "Token resource claim does not match protected resource",
    });

    const customAudienceProvider = oauthSupabaseProvider({
      projectId: "example-project",
      jwtSecret: secret,
      audience: "mcp-api",
    });
    await expect(
      customAudienceProvider
        .createTokenVerifier(protectedResource)
        .verifyAccessToken(
          await token(
            "https://example-project.supabase.co/auth/v1",
            "mcp-api",
            now() + 60
          )
        )
    ).resolves.toMatchObject({ resource: protectedResource });
    expect(() =>
      oauthSupabaseProvider({
        projectId: "example-project",
        audience: " ",
      })
    ).toThrow(/audience/);
  });

  it("uses empty clientId for Supabase tokens without client_id", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const provider = oauthSupabaseProvider({
      projectId: "example-project",
      jwtSecret: secret,
    });
    const token = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://example-project.supabase.co/auth/v1")
      .setAudience("authenticated")
      .setExpirationTime(now() + 60)
      .sign(new TextEncoder().encode(secret));

    await expect(
      provider.createTokenVerifier(protectedResource).verifyAccessToken(token)
    ).resolves.toMatchObject({ clientId: "" });
  });

  it("accepts local Supabase, preserves AMR objects, and rejects public HTTP resources", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const provider = oauthSupabaseProvider({
      supabaseUrl: "http://localhost:54321/platform",
      jwtSecret: secret,
    });
    expect(provider.oauthMetadata).toMatchObject({
      issuer: "http://localhost:54321/platform/auth/v1",
      authorization_endpoint:
        "http://localhost:54321/platform/auth/v1/oauth/authorize",
      token_endpoint: "http://localhost:54321/platform/auth/v1/oauth/token",
      registration_endpoint:
        "http://localhost:54321/platform/auth/v1/oauth/clients/register",
    });
    const token = await new SignJWT({
      sub: "user-1",
      client_id: "client-1",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("http://localhost:54321/platform/auth/v1")
      .setAudience("authenticated")
      .setExpirationTime(now() + 60)
      .sign(new TextEncoder().encode(secret));
    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        token
      )
    ).resolves.toMatchObject({
      extra: {
        user: { amr: [{ method: "password", timestamp: 1_700_000_000 }] },
      },
    });
    expect(() =>
      oauthAuth0Provider({
        domain: "issuer.example.test",
        resource: "http://api.example.test/mcp",
      })
    ).toThrow(/HTTPS|localhost/);
  });

  it("supports Clerk issuer-bound and configured-audience access tokens", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "clerk-key";
    globalThis.fetch = jwksFixture(jwk);
    const provider = oauthClerkProvider({
      frontendApiUrl: "https://clerk.example.test/tenant",
    });
    expect(provider.oauthMetadata).toMatchObject({
      issuer: "https://clerk.example.test/tenant",
      authorization_endpoint:
        "https://clerk.example.test/tenant/oauth/authorize",
      token_endpoint: "https://clerk.example.test/tenant/oauth/token",
      registration_endpoint: "https://clerk.example.test/tenant/oauth/register",
    });
    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        await signedToken(
          privateKey,
          "clerk-key",
          "https://clerk.example.test/tenant",
          undefined,
          {
            sub: "clerk-user",
            client_id: "client",
            org_role: "admin",
            org_permissions: ["read"],
          }
        )
      )
    ).resolves.toMatchObject({
      extra: {
        user: { id: "clerk-user", roles: ["admin"] },
        permissions: ["read"],
      },
    });

    const audienceProvider = oauthClerkProvider({
      frontendApiUrl: "https://clerk.example.test/tenant",
      audience: "clerk-api",
    });
    await expect(
      wrapOAuthTokenVerifier(
        audienceProvider,
        protectedResource
      ).verifyAccessToken(
        await signedToken(
          privateKey,
          "clerk-key",
          "https://clerk.example.test/tenant",
          "clerk-api",
          { sub: "clerk-user", client_id: "client" }
        )
      )
    ).resolves.toMatchObject({ resource: protectedResource });
    await expect(
      wrapOAuthTokenVerifier(
        audienceProvider,
        protectedResource
      ).verifyAccessToken(
        await signedToken(
          privateKey,
          "clerk-key",
          "https://clerk.example.test/tenant",
          "other-api",
          { sub: "clerk-user", client_id: "client" }
        )
      )
    ).rejects.toMatchObject({ code: "invalid_token" });
    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        await signedToken(
          privateKey,
          "clerk-key",
          "https://clerk.example.test/tenant",
          undefined,
          {
            sub: "clerk-user",
            client_id: "client",
            resource: "https://other.example/mcp",
          }
        )
      )
    ).rejects.toMatchObject({
      code: "invalid_token",
      message: "Token resource claim does not match protected resource",
    });
    expect(() =>
      oauthClerkProvider({
        frontendApiUrl: "https://clerk.example.test/tenant",
        audience: " ",
      })
    ).toThrow(/audience/);
  });

  it("normalizes WorkOS hosts without appending a second suffix and maps claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "workos-key";
    globalThis.fetch = jwksFixture(jwk);
    const provider = oauthWorkOSProvider({
      subdomain: "https://acme.authkit.app",
    });
    expect(provider.oauthMetadata).toMatchObject({
      issuer: "https://acme.authkit.app",
      authorization_endpoint: "https://acme.authkit.app/oauth2/authorize",
      token_endpoint: "https://acme.authkit.app/oauth2/token",
      registration_endpoint: "https://acme.authkit.app/oauth2/register",
    });
    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        await signedToken(
          privateKey,
          "workos-key",
          "https://acme.authkit.app",
          protectedResource.href,
          {
            sub: "workos-user",
            client_id: "client",
            email_verified: true,
            preferred_username: "ada",
            roles: ["admin"],
            permissions: ["read"],
            org_id: "org_1",
            sid: "session_1",
          }
        )
      )
    ).resolves.toMatchObject({
      extra: {
        user: {
          id: "workos-user",
          emailVerified: true,
          preferredUsername: "ada",
          organizationId: "org_1",
          sessionId: "session_1",
        },
        permissions: ["read"],
      },
    });
  });

  it("uses empty clientId for WorkOS AuthKit tokens without client_id or azp", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "workos-key";
    globalThis.fetch = jwksFixture(jwk);
    const provider = oauthWorkOSProvider({
      subdomain: "https://acme.authkit.app",
    });
    const token = await new SignJWT({
      sub: "workos-user",
      org_id: "org_1",
      sid: "session_1",
      jti: "jti_1",
    })
      .setProtectedHeader({ alg: "RS256", kid: "workos-key" })
      .setIssuer("https://acme.authkit.app")
      .setAudience(protectedResource.href)
      .setIssuedAt(now())
      .setExpirationTime(now() + 60)
      .sign(privateKey);

    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        token
      )
    ).resolves.toMatchObject({ clientId: "" });
  });

  it("uses Keycloak realm paths for issuer and every endpoint", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "keycloak-key";
    globalThis.fetch = jwksFixture(jwk);
    const provider = oauthKeycloakProvider({
      serverUrl: "https://keycloak.example.test/auth",
      realm: "mcp",
    });
    expect(provider.oauthMetadata).toMatchObject({
      issuer: "https://keycloak.example.test/auth/realms/mcp",
      authorization_endpoint:
        "https://keycloak.example.test/auth/realms/mcp/protocol/openid-connect/auth",
      token_endpoint:
        "https://keycloak.example.test/auth/realms/mcp/protocol/openid-connect/token",
      registration_endpoint:
        "https://keycloak.example.test/auth/realms/mcp/clients-registrations/openid-connect",
    });
    await expect(
      wrapOAuthTokenVerifier(provider, protectedResource).verifyAccessToken(
        await signedToken(
          privateKey,
          "keycloak-key",
          "https://keycloak.example.test/auth/realms/mcp",
          protectedResource.href,
          {
            sub: "keycloak-user",
            client_id: "client",
            realm_access: { roles: ["realm-role"] },
            resource_access: { api: { roles: ["write"] } },
          }
        )
      )
    ).resolves.toMatchObject({
      extra: { user: { roles: ["realm-role"] }, permissions: ["api:write"] },
    });
  });

  it("accepts Keycloak audience-only tokens when a protected resource is expected", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "keycloak-key";
    globalThis.fetch = jwksFixture(jwk);
    const expectedResource = new URL("https://api.example.test/mcp");
    const provider = oauthKeycloakProvider({
      serverUrl: "https://keycloak.example.test/auth",
      realm: "mcp",
      resource: expectedResource.href,
    });
    const token = await signedToken(
      privateKey,
      "keycloak-key",
      "https://keycloak.example.test/auth/realms/mcp",
      expectedResource.href,
      {
        sub: "keycloak-user",
        client_id: "client",
        realm_access: { roles: ["realm-role"] },
        resource_access: { api: { roles: ["write"] } },
      }
    );

    const authInfo = await wrapOAuthTokenVerifier(
      provider,
      expectedResource
    ).verifyAccessToken(token);
    expect(authInfo).toMatchObject({
      clientId: "client",
      resource: expectedResource,
      extra: { user: { roles: ["realm-role"] }, permissions: ["api:write"] },
    });
  });

  it("rejects Scalekit options that would weaken audience or issuer checks", () => {
    expect(() =>
      oauthScalekitProvider({
        environmentUrl: "not a url",
        resourceId: "res_example",
      })
    ).toThrow(/environmentUrl/);
    expect(() =>
      oauthScalekitProvider({
        environmentUrl: "https://scalekit.example.test",
        resourceId: "",
      })
    ).toThrow(/resourceId/);
    expect(() =>
      oauthScalekitProvider({
        environmentUrl: "https://scalekit.example.test",
        resourceId: "mcp_server",
      })
    ).toThrow(/resourceId/);
    expect(() =>
      oauthScalekitProvider({
        environmentUrl: "https://scalekit.example.test",
        resourceId: "res_example",
        audience: " ",
      })
    ).toThrow(/audience/);
  });

  it("verifies Scalekit JWTs for both issuers and binds audience to the resource id", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "scalekit-key";
    globalThis.fetch = jwksFixture(jwk);

    const environmentUrl = "https://scalekit.example.test";
    const resourceId = "res_example";
    const resourceIssuer = `${environmentUrl}/resources/${resourceId}`;
    const provider = oauthScalekitProvider({
      environmentUrl,
      resourceId,
      resource: protectedResource.href,
    });
    expect(provider.oauthMetadata).toMatchObject({
      issuer: resourceIssuer,
      authorization_endpoint: `${resourceIssuer}/oauth/authorize`,
      token_endpoint: `${resourceIssuer}/oauth/token`,
      jwks_uri: `${environmentUrl}/keys`,
      registration_endpoint: `${environmentUrl}/api/v1/resources/${resourceId}/clients:register`,
      client_id_metadata_document_supported: true,
    });

    const userClaims = {
      sub: "usr_example",
      client_id: "m2m_example",
      scope: "openid offline_access email profile",
      org_id: "org_example",
      sid: "ses_example",
    };
    const verifier = wrapOAuthTokenVerifier(provider, protectedResource);

    await expect(
      verifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          environmentUrl,
          [protectedResource.href, resourceId],
          userClaims
        )
      )
    ).resolves.toMatchObject({
      clientId: "m2m_example",
      scopes: ["openid", "offline_access", "email", "profile"],
      extra: {
        user: {
          id: "usr_example",
          subjectType: "user",
          organizationId: "org_example",
          sessionId: "ses_example",
        },
      },
    });

    await expect(
      verifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          resourceIssuer,
          resourceId,
          userClaims
        )
      )
    ).resolves.toMatchObject({
      extra: { user: { id: "usr_example", subjectType: "user" } },
    });

    await expect(
      verifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          environmentUrl,
          "res_other",
          userClaims
        )
      )
    ).rejects.toMatchObject({ code: "invalid_token" });

    const extraAudience = protectedResource.href;
    const bothVerifier = wrapOAuthTokenVerifier(
      oauthScalekitProvider({
        environmentUrl,
        resourceId,
        resource: protectedResource.href,
        audience: extraAudience,
      }),
      protectedResource
    );
    await expect(
      bothVerifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          environmentUrl,
          [extraAudience, resourceId],
          userClaims
        )
      )
    ).resolves.toMatchObject({
      extra: { user: { id: "usr_example", subjectType: "user" } },
    });
    await expect(
      bothVerifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          environmentUrl,
          resourceId,
          userClaims
        )
      )
    ).rejects.toMatchObject({
      code: "invalid_token",
      message: "Token audience does not include configured audience",
    });
    await expect(
      bothVerifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          environmentUrl,
          extraAudience,
          userClaims
        )
      )
    ).rejects.toMatchObject({ code: "invalid_token" });

    await expect(
      verifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          environmentUrl,
          resourceId,
          { sub: "m2m_example", client_id: "m2m_example" }
        )
      )
    ).resolves.toMatchObject({
      extra: { user: { id: "m2m_example", subjectType: "machine" } },
    });

    await expect(
      verifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "scalekit-key",
          environmentUrl,
          resourceId,
          { ...userClaims, resource: "https://other.example/mcp" }
        )
      )
    ).rejects.toMatchObject({
      code: "invalid_token",
      message: "Token resource claim does not match protected resource",
    });

    await expect(
      verifier.verifyAccessToken(
        await new SignJWT({ ...userClaims })
          .setProtectedHeader({ alg: "RS256", kid: "scalekit-key" })
          .setIssuer(environmentUrl)
          .setAudience(resourceId)
          .setExpirationTime(now() - 1)
          .sign(privateKey)
      )
    ).rejects.toMatchObject({ code: "invalid_token" });

    await expect(verifier.verifyAccessToken("not-a-jwt")).rejects.toMatchObject(
      {
        code: "invalid_token",
      }
    );
    await expect(
      verifier.verifyAccessToken(
        await new SignJWT({ ...userClaims })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuer(environmentUrl)
          .setAudience(resourceId)
          .setExpirationTime(now() + 60)
          .sign(
            new TextEncoder().encode("a sufficiently long test signing key")
          )
      )
    ).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("leaves unexpected JWKS network errors as ordinary errors", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    globalThis.fetch = async () => {
      throw new Error("JWKS service unavailable");
    };
    const provider = oauthAuth0Provider({
      domain: "issuer.example.test",
    });
    await expect(
      provider.createTokenVerifier(protectedResource).verifyAccessToken(
        await signedToken(
          privateKey,
          "missing-key",
          "https://issuer.example.test/",
          protectedResource.href,
          {
            sub: "user",
            client_id: "client",
          }
        )
      )
    ).rejects.not.toMatchObject({ code: "invalid_token" });
  });
});

function jwksFixture(jwk: Awaited<ReturnType<typeof exportJWK>>): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { "content-type": "application/json" },
    });
}

function signedToken(
  privateKey: Parameters<SignJWT["sign"]>[0],
  kid: string,
  issuer: string,
  audience: string | string[] | undefined,
  claims: Record<string, unknown>,
  algorithm = "RS256"
): Promise<string> {
  const token = new SignJWT(claims)
    .setProtectedHeader({ alg: algorithm, kid })
    .setIssuer(issuer)
    .setIssuedAt(now())
    .setExpirationTime(now() + 60);
  if (audience !== undefined) token.setAudience(audience);
  return token.sign(privateKey);
}
