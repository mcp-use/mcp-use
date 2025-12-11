/**
 * Custom OAuth Provider
 *
 * Allows users to implement custom OAuth providers with their own
 * JWT verification logic and user info extraction.
 */

import type { OAuthProvider, UserInfo, CustomOAuthConfig } from "./types.js";

export class CustomOAuthProvider implements OAuthProvider {
  private config: CustomOAuthConfig;

  constructor(config: CustomOAuthConfig) {
    this.config = config;
  }

  async verifyToken(
    token: string
  ): Promise<{ payload: Record<string, unknown> }> {
    try {
      const result = await this.config.verifyToken(token);
      return result;
    } catch (error) {
      throw new Error(`Custom OAuth verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo {
    // Use custom getUserInfo if provided, otherwise create a basic UserInfo
    if (this.config.getUserInfo) {
      return this.config.getUserInfo(payload);
    }

    // Default extraction - assume standard OIDC claims
    const scope = payload.scope as string | undefined;
    const roles = payload.roles;
    const permissions = payload.permissions;
    return {
      userId: (payload.sub || payload.user_id || payload.id) as string,
      email: payload.email ? (payload.email as string) : undefined,
      name: payload.name ? (payload.name as string) : undefined,
      username:
        payload.username || payload.preferred_username
          ? ((payload.username || payload.preferred_username) as string)
          : undefined,
      nickname: payload.nickname ? (payload.nickname as string) : undefined,
      picture:
        payload.picture || payload.avatar_url
          ? ((payload.picture || payload.avatar_url) as string)
          : undefined,
      roles: Array.isArray(roles) ? (roles as string[]) : [],
      permissions: Array.isArray(permissions) ? (permissions as string[]) : [],
      scopes: scope ? scope.split(" ") : [],
    };
  }

  getIssuer(): string {
    return this.config.issuer;
  }

  getAuthEndpoint(): string {
    return this.config.authEndpoint;
  }

  getTokenEndpoint(): string {
    return this.config.tokenEndpoint;
  }

  getScopesSupported(): string[] {
    return this.config.scopesSupported || ["openid", "profile", "email"];
  }

  getGrantTypesSupported(): string[] {
    return (
      this.config.grantTypesSupported || ["authorization_code", "refresh_token"]
    );
  }
}
