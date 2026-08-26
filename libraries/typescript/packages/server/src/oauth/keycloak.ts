/**
 * Verify Keycloak access tokens for an mcp-use resource server.
 *
 * @packageDocumentation
 */

import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

import { oauthEnvironmentValue } from "./environment.js";
import { isRecord } from "./guards.js";
import {
  booleanValue,
  createJwtVerifier,
  invalidToken,
  normalizedStrings,
  normalizedProviderUrl,
  payloadFromAuthInfo,
  providerEndpoint,
  recordValue,
  requiredString,
  stringValue,
} from "./jwt.js";
import {
  oauthCustomProvider,
  type DirectOAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Verified Keycloak user and role claims exposed to authenticated MCP callbacks. */
export interface KeycloakOAuthUser {
  /** Keycloak subject identifier. */
  id: string;
  /** Primary email address, when included in the access token. */
  email?: string;
  /** Display name, when included in the access token. */
  name?: string;
  /** Preferred username, when included in the access token. */
  preferredUsername?: string;
  /** Given name, when included in the access token. */
  givenName?: string;
  /** Family name, when included in the access token. */
  familyName?: string;
  /** Whether Keycloak has verified {@link KeycloakOAuthUser.email}. */
  emailVerified?: boolean;
  /** Realm roles from `realm_access.roles`. */
  roles: string[];
  /** Unmodified `realm_access` claim, when present. */
  realmAccess?: Record<string, unknown>;
  /** Unmodified `resource_access` claim, when present. */
  resourceAccess?: Record<string, unknown>;
}

/** Configures Keycloak JWT verification and protected-resource metadata. */
export interface KeycloakOAuthProviderOptions extends OAuthResourceOptions {
  /**
   * Base URL of the Keycloak server.
   *
   * @defaultValue `MCP_USE_OAUTH_KEYCLOAK_SERVER_URL`
   */
  serverUrl?: URL | string;
  /**
   * Keycloak realm that issues accepted access tokens.
   *
   * @defaultValue `MCP_USE_OAUTH_KEYCLOAK_REALM`
   */
  realm?: string;
}

/**
 * Creates a provider that verifies Keycloak access tokens and maps their claims.
 *
 * @param options - Keycloak server URL, realm, and resource-server settings. Defaults to v1 environment variables.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 * @throws An `Error` if the server URL or realm is missing, or a `TypeError` if either is invalid.
 *
 * @example
 * ```ts
 * import { oauthKeycloakProvider } from "mcp-use/oauth/keycloak";
 *
 * const oauth = oauthKeycloakProvider({
 *   serverUrl: "https://keycloak.example.com",
 *   realm: "production",
 * });
 * ```
 */
export function oauthKeycloakProvider(
  options: KeycloakOAuthProviderOptions = {}
): DirectOAuthProvider<KeycloakOAuthUser> {
  const serverUrlValue =
    options.serverUrl ??
    oauthEnvironmentValue("MCP_USE_OAUTH_KEYCLOAK_SERVER_URL");
  const realm =
    options.realm ?? oauthEnvironmentValue("MCP_USE_OAUTH_KEYCLOAK_REALM");
  const audience = oauthEnvironmentValue("MCP_USE_OAUTH_KEYCLOAK_AUDIENCE");
  if (serverUrlValue === undefined || realm === undefined) {
    throw new Error("Keycloak serverUrl and realm are required.");
  }
  if (
    typeof realm !== "string" ||
    realm.trim().length === 0 ||
    /[/?#]/.test(realm)
  ) {
    throw new TypeError("Keycloak realm is invalid");
  }
  const resolvedOptions = {
    ...options,
    ...(options.resource === undefined &&
      audience !== undefined && { resource: audience }),
  };
  const serverUrl = normalizedProviderUrl(serverUrlValue, "Keycloak serverUrl");
  const issuer = providerEndpoint(
    serverUrl,
    `realms/${encodeURIComponent(realm)}`
  ).replace(/\/$/, "");
  return oauthCustomProvider<KeycloakOAuthUser>({
    ...resolvedOptions,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(
          providerEndpoint(issuer, "protocol/openid-connect/certs")
        ),
        resource,
      }),
    oauthMetadata: {
      issuer,
      authorization_endpoint: providerEndpoint(
        issuer,
        "protocol/openid-connect/auth"
      ),
      token_endpoint: providerEndpoint(issuer, "protocol/openid-connect/token"),
      registration_endpoint: providerEndpoint(
        issuer,
        "clients-registrations/openid-connect"
      ),
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
  if (id === undefined) throw invalidToken("Missing Keycloak subject");
  const realmAccess = recordValue(payload, "realm_access");
  const resourceAccess = recordValue(payload, "resource_access");
  return {
    user: {
      id,
      ...optional("email", stringValue(payload, "email")),
      ...optional("name", stringValue(payload, "name")),
      ...optional(
        "preferredUsername",
        stringValue(payload, "preferred_username")
      ),
      ...optional("givenName", stringValue(payload, "given_name")),
      ...optional("familyName", stringValue(payload, "family_name")),
      ...optional("emailVerified", booleanValue(payload, "email_verified")),
      roles:
        realmAccess === undefined
          ? []
          : normalizedStrings(realmAccess["roles"]),
      ...(realmAccess !== undefined && { realmAccess }),
      ...(resourceAccess !== undefined && { resourceAccess }),
    },
    payload,
    permissions: resourcePermissions(resourceAccess),
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function resourcePermissions(
  resourceAccess: Record<string, unknown> | undefined
): string[] {
  if (resourceAccess === undefined) return [];
  return Object.entries(resourceAccess).flatMap(([resource, value]) =>
    isRecord(value)
      ? normalizedStrings(value["roles"]).map((role) => `${resource}:${role}`)
      : []
  );
}
