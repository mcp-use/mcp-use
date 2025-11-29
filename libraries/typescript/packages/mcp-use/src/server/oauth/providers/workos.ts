/**
 * WorkOS OAuth Provider
 * 
 * Implements OAuth authentication for WorkOS AuthKit.
 * Supports JWKS-based JWT verification with Dynamic Client Registration.
 * 
 * WorkOS uses "direct" mode where MCP clients communicate directly with
 * WorkOS for OAuth flows (registration, authorization, token exchange).
 * The MCP server only verifies tokens issued by WorkOS.
 * 
 * Learn more: https://workos.com/docs/authkit/mcp
 */

import { jwtVerify, createRemoteJWKSet, decodeJwt } from 'jose';
import type { OAuthProvider, UserInfo, WorkOSOAuthConfig, OAuthMode } from './types.js';

export class WorkOSOAuthProvider implements OAuthProvider {
  private config: WorkOSOAuthConfig;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: WorkOSOAuthConfig) {
    this.config = config;
    this.issuer = `https://${config.subdomain}.authkit.app`;
  }

  private getJWKS(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(
        new URL(`${this.issuer}/oauth2/jwks`)
      );
    }
    return this.jwks;
  }

  async verifyToken(token: string): Promise<any> {
    // Skip verification in development mode if configured
    if (this.config.verifyJwt === false) {
      console.warn('[WorkOS OAuth] ⚠️  JWT verification is disabled');
      console.warn('[WorkOS OAuth]     Enable verifyJwt: true for production');
      
      // Decode without verification
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
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

  getUserInfo(payload: any): UserInfo {
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      username: payload.preferred_username,
      picture: payload.picture,
      // WorkOS includes permissions and roles in token
      permissions: payload.permissions || [],
      roles: payload.roles || [],
      // Include scope as well
      scopes: payload.scope ? payload.scope.split(' ') : [],
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
    return ['email', 'offline_access', 'openid', 'profile'];
  }

  getGrantTypesSupported(): string[] {
    return ['authorization_code', 'refresh_token'];
  }

  getMode(): OAuthMode {
    // If a client_id is configured, use proxy mode so we can inject it
    // Otherwise use direct mode with Dynamic Client Registration
    if (this.config.clientId) {
      console.log('[WorkOS OAuth] Using proxy mode (pre-registered client)');
      return 'proxy';
    }
    console.log('[WorkOS OAuth] Using direct mode (Dynamic Client Registration)');
    return 'direct';
  }

  getRegistrationEndpoint(): string | undefined {
    // Only provide registration endpoint when NOT using a pre-registered client
    if (this.config.clientId) {
      return undefined; // No DCR when using pre-registered client
    }
    return `${this.issuer}/oauth2/register`;
  }
}

