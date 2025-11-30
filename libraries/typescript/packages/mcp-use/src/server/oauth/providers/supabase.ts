/**
 * Supabase OAuth Provider
 *
 * Implements OAuth authentication for Supabase projects.
 * Supports both HS256 (legacy) and ES256 (new ECC) signing algorithms.
 */

import {
  jwtVerify,
  createRemoteJWKSet,
  decodeProtectedHeader,
  decodeJwt,
} from "jose";
import type { OAuthProvider, UserInfo, SupabaseOAuthConfig } from "./types.js";

export class SupabaseOAuthProvider implements OAuthProvider {
  private config: SupabaseOAuthConfig;
  private supabaseUrl: string;
  private supabaseAuthUrl: string;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: SupabaseOAuthConfig) {
    this.config = config;
    this.supabaseUrl = `https://${config.projectId}.supabase.co`;
    this.supabaseAuthUrl = `${this.supabaseUrl}/auth/v1`;
    this.issuer = `${this.supabaseUrl}/auth/v1`;
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
    if (this.config.skipVerification) {
      console.warn(
        "[Supabase OAuth] ⚠️  SKIPPING VERIFICATION (DEVELOPMENT MODE)"
      );
      console.warn(
        "[Supabase OAuth]     This is NOT secure! Only use for testing!"
      );
      const payload = decodeJwt(token);
      return { payload, protectedHeader: decodeProtectedHeader(token) };
    }

    try {
      // Decode header to check which algorithm is used
      const header = decodeProtectedHeader(token);

      if (header.alg === "HS256") {
        // HS256 uses symmetric key
        if (!this.config.jwtSecret) {
          throw new Error(
            "JWT Secret is required for HS256 tokens. " +
              "Get it from: Supabase Dashboard → Project Settings → API → JWT Settings"
          );
        }

        const secret = new TextEncoder().encode(this.config.jwtSecret);
        const result = await jwtVerify(token, secret, {
          issuer: this.issuer,
          audience: "authenticated",
        });
        return result;
      } else if (header.alg === "ES256") {
        // ES256 uses asymmetric key - JWK Set
        const result = await jwtVerify(token, this.getJWKS(), {
          issuer: this.issuer,
          audience: "authenticated",
        });
        return result;
      } else {
        throw new Error(`Unsupported algorithm: ${header.alg}`);
      }
    } catch (error) {
      throw new Error(`Supabase JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: any): UserInfo {
    return {
      userId: payload.sub || payload.user_id,
      email: payload.email,
      name: payload.user_metadata?.name || payload.user_metadata?.full_name,
      username: payload.user_metadata?.username,
      picture: payload.user_metadata?.avatar_url,
      roles: payload.role ? [payload.role] : [],
      permissions: payload.aal ? [`aal:${payload.aal}`] : [],
      // Include Supabase-specific claims
      aal: payload.aal, // Authentication Assurance Level
      amr: payload.amr, // Authentication Methods References
      session_id: payload.session_id,
    };
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAuthEndpoint(): string {
    return `${this.supabaseAuthUrl}/authorize`;
  }

  getTokenEndpoint(): string {
    return `${this.supabaseAuthUrl}/token`;
  }

  getScopesSupported(): string[] {
    return [];
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "refresh_token"];
  }
}
