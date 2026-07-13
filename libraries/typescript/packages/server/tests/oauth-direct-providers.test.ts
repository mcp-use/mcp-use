import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { oauthAuth0Provider } from "../src/oauth/auth0.js";
import { oauthClerkProvider } from "../src/oauth/clerk.js";
import { wrapOAuthTokenVerifier } from "../src/oauth/internal.js";
import { oauthKeycloakProvider } from "../src/oauth/keycloak.js";
import { oauthSupabaseProvider } from "../src/oauth/supabase.js";
import { oauthWorkOSProvider } from "../src/oauth/workos.js";

const now = () => Math.floor(Date.now() / 1000);
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("direct OAuth providers", () => {
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
      audience: "https://api.example.test/mcp",
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

    const verifier = wrapOAuthTokenVerifier(provider);
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
    const verifier = provider.tokenVerifier;
    const token = (issuer: string, audience: string, exp: number) =>
      new SignJWT({ sub: "user-1", client_id: "client-1" })
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
      provider.tokenVerifier.verifyAccessToken(token)
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
      wrapOAuthTokenVerifier(provider).verifyAccessToken(token)
    ).resolves.toMatchObject({
      extra: {
        user: { amr: [{ method: "password", timestamp: 1_700_000_000 }] },
      },
    });
    expect(() =>
      oauthAuth0Provider({
        domain: "issuer.example.test",
        audience: "audience",
        resource: "http://api.example.test/mcp",
      })
    ).toThrow(/HTTPS|localhost/);
  });

  it("maps Clerk claims and retains issuer path prefixes in endpoints", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    jwk.kid = "clerk-key";
    globalThis.fetch = jwksFixture(jwk);
    const provider = oauthClerkProvider({
      frontendApiUrl: "https://clerk.example.test/tenant",
      audience: "mcp",
    });
    expect(provider.oauthMetadata).toMatchObject({
      issuer: "https://clerk.example.test/tenant",
      authorization_endpoint:
        "https://clerk.example.test/tenant/oauth/authorize",
      token_endpoint: "https://clerk.example.test/tenant/oauth/token",
      registration_endpoint:
        "https://clerk.example.test/tenant/oauth/register",
    });
    await expect(
      wrapOAuthTokenVerifier(provider).verifyAccessToken(
        await signedToken(
          privateKey,
          "clerk-key",
          "https://clerk.example.test/tenant",
          "mcp",
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
      wrapOAuthTokenVerifier(provider).verifyAccessToken(
        await signedToken(
          privateKey,
          "workos-key",
          "https://acme.authkit.app",
          undefined,
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
      .setAudience("https://acme.authkit.app")
      .setIssuedAt(now())
      .setExpirationTime(now() + 60)
      .sign(privateKey);

    await expect(
      wrapOAuthTokenVerifier(provider).verifyAccessToken(token)
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
      audience: "mcp-api",
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
      wrapOAuthTokenVerifier(provider).verifyAccessToken(
        await signedToken(
          privateKey,
          "keycloak-key",
          "https://keycloak.example.test/auth/realms/mcp",
          "mcp-api",
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
      audience: "mcp-api",
      resource: expectedResource.href,
    });
    const token = await signedToken(
      privateKey,
      "keycloak-key",
      "https://keycloak.example.test/auth/realms/mcp",
      "mcp-api",
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
      extra: { user: { roles: ["realm-role"] }, permissions: ["api:write"] },
    });
    expect(authInfo.resource).toBeUndefined();
  });

  it("leaves unexpected JWKS network errors as ordinary errors", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    globalThis.fetch = async () => {
      throw new Error("JWKS service unavailable");
    };
    const provider = oauthAuth0Provider({
      domain: "issuer.example.test",
      audience: "audience",
    });
    await expect(
      provider.tokenVerifier.verifyAccessToken(
        await signedToken(
          privateKey,
          "missing-key",
          "https://issuer.example.test/",
          "audience",
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
  audience: string | undefined,
  claims: Record<string, unknown>
): Promise<string> {
  const token = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setIssuedAt(now())
    .setExpirationTime(now() + 60);
  if (audience !== undefined) token.setAudience(audience);
  return token.sign(privateKey);
}
