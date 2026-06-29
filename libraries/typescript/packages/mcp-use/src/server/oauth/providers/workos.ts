/**
 * WorkOS OAuth Provider
 *
 * Implements OAuth authentication for WorkOS AuthKit.
 * Supports JWKS-based JWT verification with Dynamic Client Registration.
 *
 * MCP clients discover WorkOS's OAuth endpoints via `.well-known`
 * passthrough and communicate directly with WorkOS for registration,
 * authorization, and token exchange. The MCP server only verifies
 * tokens issued by WorkOS.
 *
 * Learn more: https://workos.com/docs/authkit/mcp
 */

import { jwtVerify, createRemoteJWKSet, decodeJwt } from "jose";
import type {
  OAuthProvider,
  UserInfo,
  WorkOSOAuthConfig,
  OAuthTokenVerificationResult,
} from "./types.js";

export class WorkOSOAuthProvider implements OAuthProvider {
  private config: WorkOSOAuthConfig;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: WorkOSOAuthConfig) {
    this.config = config;
    this.issuer = `https://${config.subdomain}`;
  }

  private getJWKS(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/oauth2/jwks`));
    }
    return this.jwks;
  }

  async verifyToken(token: string): Promise<OAuthTokenVerificationResult> {
    // Skip verification in development mode if configured
    if (this.config.verifyJwt === false) {
      console.warn("[WorkOS OAuth] ⚠️  JWT verification is disabled");
      console.warn("[WorkOS OAuth]     Enable verifyJwt: true for production");

      // Decode without verification
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }
      const payload = decodeJwt(token);
      return { payload };
    }

    try {
      const result = await jwtVerify(token, this.getJWKS(), {
        issuer: this.issuer,
      });
      return result;
    } catch (error) {
      throw new Error(`WorkOS JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo {
    const scope = payload.scope as string | undefined;
    return {
      userId: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      username: payload.preferred_username as string | undefined,
      picture: payload.picture as string | undefined,
      // WorkOS includes permissions and roles in token
      permissions: Array.isArray(payload.permissions)
        ? (payload.permissions as string[])
        : [],
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      // Include scope as well
      scopes: scope ? scope.split(" ") : [],
      // Additional WorkOS-specific claims
      email_verified: payload.email_verified,
      organization_id: payload.org_id,
      sid: payload.sid, // Session ID
    };
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAuthEndpoint(): string {
    return `${this.issuer}/oauth2/authorize`;
  }

  getTokenEndpoint(): string {
    return `${this.issuer}/oauth2/token`;
  }

  getScopesSupported(): string[] {
    return (
      this.config.scopesSupported ?? [
        "email",
        "offline_access",
        "openid",
        "profile",
      ]
    );
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "refresh_token"];
  }
}
