/**
 * Custom OAuth Provider
 * 
 * Allows users to implement custom OAuth providers with their own
 * JWT verification logic and user info extraction.
 */

import type { OAuthProvider, UserInfo, CustomOAuthConfig } from './types.js';

export class CustomOAuthProvider implements OAuthProvider {
  private config: CustomOAuthConfig;

  constructor(config: CustomOAuthConfig) {
    this.config = config;
  }

  async verifyToken(token: string): Promise<any> {
    try {
      const result = await this.config.verifyToken(token);
      return { payload: result };
    } catch (error) {
      throw new Error(`Custom OAuth verification failed: ${error}`);
    }
  }

  getUserInfo(payload: any): UserInfo {
    // Use custom getUserInfo if provided, otherwise create a basic UserInfo
    if (this.config.getUserInfo) {
      return this.config.getUserInfo(payload);
    }

    // Default extraction - assume standard OIDC claims
    return {
      userId: payload.sub || payload.user_id || payload.id,
      email: payload.email,
      name: payload.name,
      username: payload.username || payload.preferred_username,
      nickname: payload.nickname,
      picture: payload.picture || payload.avatar_url,
      roles: payload.roles || [],
      permissions: payload.permissions || [],
      scopes: payload.scope ? payload.scope.split(' ') : [],
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
    return this.config.scopesSupported || ['openid', 'profile', 'email'];
  }

  getGrantTypesSupported(): string[] {
    return this.config.grantTypesSupported || ['authorization_code', 'refresh_token'];
  }
}

