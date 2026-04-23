/**
 * Better Auth OAuth Provider
 *
 * Implements OAuth authentication for Better Auth instances using the
 * OAuth Provider plugin. MCP clients discover Better Auth's OAuth
 * endpoints via `.well-known` passthrough and communicate directly with
 * Better Auth for registration, authorization, and token exchange. The
 * MCP server only verifies tokens issued by Better Auth.
 *
 * Learn more: https://better-auth.com/docs/plugins/oauth-provider
 */

import { jwtVerify, createRemoteJWKSet, decodeJwt } from "jose";
import type {
  OAuthProvider,
  UserInfo,
  BetterAuthOAuthConfig,
} from "./types.js";

export class BetterAuthOAuthProvider implements OAuthProvider {
  private config: BetterAuthOAuthConfig;
  private authURL: string;
  private issuer: string;
  private jwksUrl: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: BetterAuthOAuthConfig) {
    this.config = config;
    // Normalize authURL by stripping trailing slash
    this.authURL = config.authURL.endsWith("/")
      ? config.authURL.slice(0, -1)
      : config.authURL;
    // Better Auth sets iss to ctx.context.authURL (the full base URL including path)
    this.issuer = this.authURL;
    // Better Auth always exposes JWKS at /jwks
    this.jwksUrl = `${this.authURL}/jwks`;
  }

  private getJWKS(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(this.jwksUrl));
    }
    return this.jwks;
  }

  async verifyToken(token: string): Promise<any> {
    // Skip verification in development mode if configured
    if (this.config.verifyJwt === false) {
      console.warn("[Better Auth OAuth] ⚠️  JWT verification is disabled");
      console.warn(
        "[Better Auth OAuth]     Enable verifyJwt: true for production"
      );

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
      throw new Error(`Better Auth JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo | Promise<UserInfo> {
    if (this.config.getUserInfo) {
      return this.config.getUserInfo(payload);
    }

    const scope = payload.scope as string | undefined;
    return {
      userId: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      picture: payload.picture as string | undefined,
      // Better Auth doesn't include roles/permissions in access tokens by default,
      // but they can be added via customAccessTokenClaims
      roles: (payload.roles as string[]) || [],
      permissions: (payload.permissions as string[]) || [],
      scopes: scope ? scope.split(" ") : [],
      // Better Auth-specific claims
      azp: payload.azp, // Authorized party (client ID)
      sid: payload.sid, // Session ID
      email_verified: payload.email_verified,
    };
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAuthEndpoint(): string {
    return `${this.authURL}/oauth2/authorize`;
  }

  getTokenEndpoint(): string {
    return `${this.authURL}/oauth2/token`;
  }

  getScopesSupported(): string[] {
    return (
      this.config.scopesSupported ?? [
        "openid",
        "profile",
        "email",
        "offline_access",
      ]
    );
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "client_credentials", "refresh_token"];
  }
}
