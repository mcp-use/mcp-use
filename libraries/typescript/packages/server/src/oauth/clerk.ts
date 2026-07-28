import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

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
  type OAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Verified Clerk user and organization claims exposed to authenticated MCP callbacks. */
export interface ClerkOAuthUser {
  id: string;
  email?: string;
  name?: string;
  username?: string;
  picture?: string;
  emailVerified?: boolean;
  organizationId?: string;
  organizationRole?: string;
  organizationSlug?: string;
  roles: string[];
}

/** Configures Clerk JWT verification and protected-resource metadata. */
export interface ClerkOAuthProviderOptions extends OAuthResourceOptions {
  frontendApiUrl: URL | string;
  /** Expected Clerk access-token audience, when the application emits one. */
  audience?: string;
}

/**
 * Creates a provider that verifies Clerk access tokens and maps their claims.
 *
 * @param options - Clerk frontend API URL, optional token audience, and resource-server settings.
 * @returns A provider that verifies Clerk-issued access tokens and explicit resource claims.
 */
export function oauthClerkProvider(
  options: ClerkOAuthProviderOptions
): OAuthProvider<ClerkOAuthUser> {
  if (
    options.audience !== undefined &&
    (typeof options.audience !== "string" ||
      options.audience.trim().length === 0)
  ) {
    throw new TypeError("Clerk audience must be non-empty");
  }
  const issuer = normalizedProviderUrl(
    options.frontendApiUrl,
    "Clerk frontendApiUrl"
  ).href.replace(/\/$/, "");
  return oauthCustomProvider<ClerkOAuthUser>({
    ...options,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(providerEndpoint(issuer, ".well-known/jwks.json")),
        resource,
        ...(options.audience !== undefined
          ? { audience: options.audience }
          : { issuerBoundAccessTokens: true }),
      }),
    oauthMetadata: metadata(issuer),
    mapAuthInfo: (authInfo) => mapUser(authInfo),
  });
}

function mapUser(authInfo: AuthInfo) {
  const payload = payloadFromAuthInfo(authInfo);
  const id = requiredString(payload, "sub");
  if (id === undefined) throw invalidToken("Missing Clerk subject");
  const organizationRole = stringValue(payload, "org_role");
  return {
    user: {
      id,
      ...optional("email", stringValue(payload, "email")),
      ...optional("name", stringValue(payload, "name")),
      ...optional("username", stringValue(payload, "username")),
      ...optional("picture", stringValue(payload, "picture")),
      ...optional("emailVerified", booleanValue(payload, "email_verified")),
      ...optional("organizationId", stringValue(payload, "org_id")),
      ...optional("organizationRole", organizationRole),
      ...optional("organizationSlug", stringValue(payload, "org_slug")),
      roles: organizationRole === undefined ? [] : [organizationRole],
    },
    payload,
    permissions: normalizedStrings(payload["org_permissions"]),
  };
}

function metadata(issuer: string): OAuthMetadata {
  return {
    issuer,
    authorization_endpoint: providerEndpoint(issuer, "oauth/authorize"),
    token_endpoint: providerEndpoint(issuer, "oauth/token"),
    registration_endpoint: providerEndpoint(issuer, "oauth/register"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
