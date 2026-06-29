/**
 * Clerk OAuth Provider
 *
 * Implements OAuth authentication for Clerk.
 * Supports JWKS-based JWT verification with Dynamic Client Registration.
 *
 * MCP clients discover Clerk's OAuth endpoints via `.well-known` passthrough
 * and communicate directly with Clerk for registration, authorization, and
 * token exchange. The MCP server only verifies tokens issued by Clerk.
 *
 * Clerk Frontend API URL formats:
 * - Development: https://[verb-noun-##].clerk.accounts.dev
 * - Production:  https://clerk.[YOUR_APP_DOMAIN].com
 *
 * Learn more: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth
 */

import { jwtVerify, createRemoteJWKSet, decodeJwt } from "jose";
import type {
  OAuthProvider,
  UserInfo,
  ClerkOAuthConfig,
  OAuthTokenVerificationResult,
} from "./types.js";

export class ClerkOAuthProvider implements OAuthProvider {
  private config: ClerkOAuthConfig;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: ClerkOAuthConfig) {
    this.config = config;
    // Remove trailing slash — Clerk issuer has none
    this.issuer = config.frontendApiUrl.replace(/\/$/, "");
  }

  private getJWKS(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(
        new URL(`${this.issuer}/.well-known/jwks.json`)
      );
    }
    return this.jwks;
  }

  async verifyToken(token: string): Promise<OAuthTokenVerificationResult> {
    if (this.config.verifyJwt === false) {
      console.warn("[Clerk OAuth] ⚠️  JWT verification is disabled");
      console.warn("[Clerk OAuth]     Enable verifyJwt: true for production");

      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }
      const payload = decodeJwt(token);
      return { payload };
    }

    try {
      const verifyOptions: Parameters<typeof jwtVerify>[2] = {
        issuer: this.issuer,
      };
      if (this.config.audience) {
        verifyOptions.audience = this.config.audience;
      }
      const result = await jwtVerify(token, this.getJWKS(), verifyOptions);
      return result;
    } catch (error) {
      throw new Error(`Clerk JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo {
    // Clerk includes org permissions as an array when using organizations
    const orgPermissions = Array.isArray(payload.org_permissions)
      ? payload.org_permissions.filter(
          (permission): permission is string => typeof permission === "string"
        )
      : [];
    const scope = payload.scope as string | undefined;

    return {
      userId: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      username: payload.username as string | undefined,
      picture: payload.picture as string | undefined,
      // Org role exposed as a role array for consistency with other providers
      roles: payload.org_role ? [payload.org_role as string] : [],
      permissions: orgPermissions,
      scopes: scope ? scope.split(" ") : [],
      // Clerk-specific claims
      email_verified: payload.email_verified,
      org_id: payload.org_id,
      org_role: payload.org_role,
      org_slug: payload.org_slug,
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
    return (
      this.config.scopesSupported ?? ["profile", "email", "offline_access"]
    );
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "refresh_token"];
  }
}
