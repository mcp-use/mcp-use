/**
 * Verify Auth0 access tokens for an mcp-use resource server.
 *
 * @packageDocumentation
 */

import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

import { oauthEnvironmentValue } from "./environment.js";
import {
  booleanValue,
  createJwtVerifier,
  invalidToken,
  normalizedStrings,
  normalizedProviderUrl,
  payloadFromAuthInfo,
  providerEndpoint,
  requiredString,
  stringValue,
} from "./jwt.js";
import {
  oauthCustomProvider,
  type DirectOAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Verified Auth0 user claims exposed to authenticated MCP callbacks. */
export interface Auth0OAuthUser {
  /** Auth0 subject identifier. */
  id: string;
  /** Primary email address, when included in the access token. */
  email?: string;
  /** Display name, when included in the access token. */
  name?: string;
  /** Auth0 nickname, when included in the access token. */
  nickname?: string;
  /** Profile image URL, when included in the access token. */
  picture?: string;
  /** Whether Auth0 has verified {@link Auth0OAuthUser.email}. */
  emailVerified?: boolean;
  /** ISO timestamp for the most recent profile update. */
  updatedAt?: string;
  /** Roles from the access token's `roles` claim. */
  roles: string[];
}

/** Configures Auth0 JWT verification and protected-resource metadata. */
export interface Auth0OAuthProviderOptions extends OAuthResourceOptions {
  /**
   * Auth0 tenant domain or issuer URL.
   *
   * @defaultValue `MCP_USE_OAUTH_AUTH0_DOMAIN`
   */
  domain?: URL | string;
}

/**
 * Creates a provider that verifies Auth0 access tokens and maps their claims.
 *
 * @param options - Auth0 domain and resource-server settings. Defaults to v1 environment variables.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 * @throws An `Error` if no domain is configured, or a `TypeError` if it is not a valid HTTP or HTTPS URL.
 *
 * @example
 * ```ts
 * import { oauthAuth0Provider } from "mcp-use/oauth/auth0";
 *
 * const oauth = oauthAuth0Provider({
 *   domain: "https://example.us.auth0.com",
 * });
 * ```
 */
export function oauthAuth0Provider(
  options: Auth0OAuthProviderOptions = {}
): DirectOAuthProvider<Auth0OAuthUser> {
  const domain =
    options.domain ?? oauthEnvironmentValue("MCP_USE_OAUTH_AUTH0_DOMAIN");
  const audience = oauthEnvironmentValue("MCP_USE_OAUTH_AUTH0_AUDIENCE");
  if (domain === undefined) {
    throw new Error("Auth0 domain is required.");
  }
  const resolvedOptions = {
    ...options,
    ...(options.resource === undefined &&
      audience !== undefined && { resource: audience }),
  };
  const issuer = normalizedProviderUrl(domain, "Auth0 domain").href;
  return oauthCustomProvider<Auth0OAuthUser>({
    ...resolvedOptions,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(providerEndpoint(issuer, ".well-known/jwks.json")),
        resource,
      }),
    oauthMetadata: {
      issuer,
      authorization_endpoint: providerEndpoint(issuer, "authorize"),
      token_endpoint: providerEndpoint(issuer, "oauth/token"),
      registration_endpoint: providerEndpoint(issuer, "oidc/register"),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    } satisfies OAuthMetadata,
    mapAuthInfo: mapUser,
  });
}

function mapUser(authInfo: AuthInfo) {
  const payload = payloadFromAuthInfo(authInfo);
  const id = requiredString(payload, "sub");
  if (id === undefined) throw invalidToken("Missing Auth0 subject");
  return {
    user: {
      id,
      ...optional("email", stringValue(payload, "email")),
      ...optional("name", stringValue(payload, "name")),
      ...optional("nickname", stringValue(payload, "nickname")),
      ...optional("picture", stringValue(payload, "picture")),
      ...optional("emailVerified", booleanValue(payload, "email_verified")),
      ...optional("updatedAt", stringValue(payload, "updated_at")),
      roles: normalizedStrings(payload["roles"]),
    },
    payload,
    permissions: normalizedStrings(payload["permissions"]),
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
