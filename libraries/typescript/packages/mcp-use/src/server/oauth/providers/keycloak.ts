/**
 * Keycloak OAuth Provider
 *
 * Implements OAuth authentication for Keycloak servers.
 * Supports realm roles, client roles, and resource access.
 */

import { jwtVerify, createRemoteJWKSet } from "jose";
import type { OAuthProvider, UserInfo, KeycloakOAuthConfig } from "./types.js";

export class KeycloakOAuthProvider implements OAuthProvider {
  private config: KeycloakOAuthConfig;
  private issuer: string;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(config: KeycloakOAuthConfig) {
    this.config = config;
    // Remove trailing slash from serverUrl if present
    const serverUrl = config.serverUrl.replace(/\/$/, "");
    this.issuer = `${serverUrl}/realms/${config.realm}`;
  }

  private getJWKS(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(
        new URL(`${this.issuer}/protocol/openid-connect/certs`)
      );
    }
    return this.jwks;
  }

  async verifyToken(token: string): Promise<any> {
    // Skip verification in development mode if configured
    if (this.config.verifyJwt === false) {
      console.warn("[Keycloak OAuth] ⚠️  JWT verification is disabled");
      console.warn(
        "[Keycloak OAuth]     Enable verifyJwt: true for production"
      );

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
      // Keycloak tokens can have multiple audiences
      const result = await jwtVerify(token, this.getJWKS(), {
        issuer: this.issuer,
        // Don't verify audience if not specified
        ...(this.config.clientId && { audience: this.config.clientId }),
      });
      return result;
    } catch (error) {
      throw new Error(`Keycloak JWT verification failed: ${error}`);
    }
  }

  getUserInfo(payload: Record<string, unknown>): UserInfo {
    // Extract realm roles
    const realmAccess = payload.realm_access as
      | Record<string, unknown>
      | undefined;
    const realmRoles = (realmAccess?.roles as string[]) || [];

    // Extract client roles (if clientId is specified)
    const resourceAccess = payload.resource_access as
      | Record<string, Record<string, unknown>>
      | undefined;
    const clientRoles =
      (this.config.clientId &&
        ((resourceAccess?.[this.config.clientId]?.roles as string[]) || [])) ||
      [];

    // Combine all roles
    const allRoles = [...realmRoles, ...clientRoles];

    // Extract resource access for permissions
    const permissions: string[] = [];
    if (payload.resource_access) {
      Object.entries(payload.resource_access).forEach(
        ([resource, access]: [string, any]) => {
          if (access.roles) {
            access.roles.forEach((role: string) => {
              permissions.push(`${resource}:${role}`);
            });
          }
        }
      );
    }

    const scope = payload.scope as string | undefined;
    return {
      userId: payload.sub as string,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      username: payload.preferred_username as string | undefined,
      nickname: payload.preferred_username as string | undefined,
      picture: payload.picture as string | undefined,
      roles: allRoles,
      permissions,
      // Include scope as well
      scopes: scope ? scope.split(" ") : [],
      // Keycloak-specific claims
      email_verified: payload.email_verified,
      given_name: payload.given_name,
      family_name: payload.family_name,
      realm_access: payload.realm_access,
      resource_access: payload.resource_access,
    };
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAuthEndpoint(): string {
    return `${this.issuer}/protocol/openid-connect/auth`;
  }

  getTokenEndpoint(): string {
    return `${this.issuer}/protocol/openid-connect/token`;
  }

  getScopesSupported(): string[] {
    return ["openid", "profile", "email", "offline_access", "roles"];
  }

  getGrantTypesSupported(): string[] {
    return ["authorization_code", "refresh_token", "client_credentials"];
  }
}
