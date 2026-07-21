import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

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
  oauthEnvironmentValue,
  oauthCustomProvider,
  type OAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Verified Keycloak user and role claims exposed to authenticated MCP callbacks. */
export interface KeycloakOAuthUser {
  id: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
  givenName?: string;
  familyName?: string;
  emailVerified?: boolean;
  roles: string[];
  realmAccess?: Record<string, unknown>;
  resourceAccess?: Record<string, unknown>;
}

/** Configures Keycloak JWT verification and protected-resource metadata. */
export interface KeycloakOAuthProviderOptions extends OAuthResourceOptions {
  serverUrl?: URL | string;
  realm?: string;
  audience?: string;
}

/**
 * Creates a provider that verifies Keycloak access tokens and maps their claims.
 *
 * @param options - Keycloak server URL, realm, and resource-server settings.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 */
export function oauthKeycloakProvider(
  options: KeycloakOAuthProviderOptions = {}
): OAuthProvider<KeycloakOAuthUser> {
  const serverUrlValue =
    options.serverUrl ??
    oauthEnvironmentValue("MCP_USE_OAUTH_KEYCLOAK_SERVER_URL");
  if (serverUrlValue === undefined) {
    throw new Error(
      "Keycloak serverUrl is required. Set MCP_USE_OAUTH_KEYCLOAK_SERVER_URL or pass serverUrl in config."
    );
  }
  const realm =
    options.realm ?? oauthEnvironmentValue("MCP_USE_OAUTH_KEYCLOAK_REALM");
  if (
    typeof realm !== "string" ||
    realm.trim().length === 0 ||
    /[/?#]/.test(realm)
  ) {
    throw new Error(
      "Keycloak realm is required and must be valid. Set MCP_USE_OAUTH_KEYCLOAK_REALM or pass realm in config."
    );
  }
  const audience =
    options.audience ??
    oauthEnvironmentValue("MCP_USE_OAUTH_KEYCLOAK_AUDIENCE");
  const serverUrl = normalizedProviderUrl(serverUrlValue, "Keycloak serverUrl");
  const issuer = providerEndpoint(
    serverUrl,
    `realms/${encodeURIComponent(realm)}`
  ).replace(/\/$/, "");
  return oauthCustomProvider<KeycloakOAuthUser>({
    ...options,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(
          providerEndpoint(issuer, "protocol/openid-connect/certs")
        ),
        resource,
        ...(audience !== undefined && { audience }),
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
