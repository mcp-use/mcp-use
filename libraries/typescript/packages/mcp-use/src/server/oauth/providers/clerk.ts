/**
 * Clerk OAuth Provider
 *
 * Implements OAuth authentication for Clerk tenants.
 * Supports two token formats issued by Clerk:
 *
 * 1. **Opaque tokens** (`oat_...`) — issued to OAuth clients (e.g. Cursor, Claude Code).
 *    Verified via network call to Clerk's `/oauth/userinfo` endpoint.
 *
 * 2. **JWT session tokens** — issued in Inspector / browser flows.
 *    Verified locally using JWKS (or skipped when `verifyJwt: false` for dev).
 */
import { jwtVerify, createRemoteJWKSet } from "jose";
import type { OAuthProvider, OAuthMode, UserInfo, ClerkOAuthConfig } from "./types.js";

export class ClerkOAuthProvider implements OAuthProvider {
  protected config: ClerkOAuthConfig;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: ClerkOAuthConfig) {
    this.config = config;
    this.issuer = `https://${config.domain}`;
  }

  private getJWKS(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(
        new URL(`${this.issuer}/.well-known/jwks.json`)
      );
    }
    return this.jwks;
  }

  async verifyToken(token: string): Promise<any> {
    // Opaque tokens (oat_...) cannot be parsed as JWTs.
    // Verify them by calling Clerk's /oauth/userinfo endpoint.
    if (token.startsWith("oat_")) {
      const res = await fetch(`${this.issuer}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(
          `Clerk opaque token verification failed: ${res.status} ${res.statusText}`
        );
      }
      const payload = await res.json() as Record<string, unknown>;
      return { payload };
    }

    // JWT session tokens — skip verification in dev if configured.
    if (this.config.verifyJwt === false) {
      console.warn("[Clerk OAuth] ⚠️  JWT verification is disabled");
      console.warn("[Clerk OAuth]     Enable verifyJwt: true for production");

      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      ) as Record<string, unknown>;
      return { payload };
    }

    try {
      const result = await jwtVerify(token, this.getJWKS(), {
        issuer: this.issuer,
      });
      return result;
    } catch (error) {
      throw new Error(`Clerk JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo {
    const firstName = payload.first_name as string | undefined;
    const lastName = payload.last_name as string | undefined;
    const fullName =
      firstName || lastName
        ? [firstName, lastName].filter(Boolean).join(" ")
        : undefined;

    const picture =
      (payload.image_url as string | undefined) ||
      (payload.picture as string | undefined);

    const orgId = payload.org_id as string | undefined;
    const orgRole = payload.org_role as string | undefined;
    const orgPermissions = (payload.org_permissions as string[]) || [];

    const roles: string[] = orgRole
      ? [orgRole]
      : (payload.roles as string[]) || [];

    const permissions: string[] =
      orgPermissions.length > 0
        ? orgPermissions
        : (payload.permissions as string[]) || [];

    return {
      userId: payload.sub as string,
      email: payload.email as string | undefined,
      name: fullName,
      picture,
      roles,
      permissions,

      org_id: orgId,
      org_role: orgRole,
      org_permissions: orgPermissions,

      email_verified: payload.email_verified,

      first_name: firstName,
      last_name: lastName,
    };
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAuthEndpoint(): string {
    return `${this.issuer}/oauth/authorize`;
  }

  getTokenEndpoint(): string {
    return `${this.issuer}/oauth/token`;
  }

  getScopesSupported(): string[] {
    return ["openid", "profile", "email"];
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "refresh_token"];
  }


  getMode(): OAuthMode {
    return "direct";
  }

  getRegistrationEndpoint(): string | undefined {
    return undefined;
  }

  usesOidcDiscovery(): boolean {
    return true;
  }
}