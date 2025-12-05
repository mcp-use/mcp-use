/**
 * Auth0 OAuth Provider
 *
 * Implements OAuth authentication for Auth0 tenants.
 * Supports JWKS-based JWT verification with permissions and roles.
 */

import { jwtVerify, createRemoteJWKSet } from "jose";
import type { OAuthProvider, UserInfo, Auth0OAuthConfig } from "./types.js";

export class Auth0OAuthProvider implements OAuthProvider {
  private config: Auth0OAuthConfig;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: Auth0OAuthConfig) {
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
    // Skip verification in development mode if configured
    if (this.config.verifyJwt === false) {
      console.warn("[Auth0 OAuth] ⚠️  JWT verification is disabled");
      console.warn("[Auth0 OAuth]     Enable verifyJwt: true for production");

      // Decode without verification
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      );
      return { payload };
    }

    try {
      const result = await jwtVerify(token, this.getJWKS(), {
        issuer: this.issuer,
        audience: this.config.audience,
      });
      return result;
    } catch (error) {
      throw new Error(`Auth0 JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo {
    const scope = payload.scope as string | undefined;
    return {
      userId: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      username: payload.username as string | undefined,
      nickname: payload.nickname as string | undefined,
      picture: payload.picture as string | undefined,
      // Auth0 includes permissions directly in the token
      permissions: (payload.permissions as string[]) || [],
      // Auth0 can include roles (if configured)
      roles:
        (payload.roles as string[]) ||
        (payload["https://your-app.com/roles"] as string[]) ||
        [],
      // Include scope as well
      scopes: scope ? scope.split(" ") : [],
      // Additional Auth0-specific claims
      email_verified: payload.email_verified,
      updated_at: payload.updated_at,
    };
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAuthEndpoint(): string {
    return `${this.issuer}/authorize`;
  }

  getTokenEndpoint(): string {
    return `${this.issuer}/oauth/token`;
  }

  getScopesSupported(): string[] {
    return ["openid", "profile", "email", "offline_access"];
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "refresh_token"];
  }
}
