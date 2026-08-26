/**
 * Verify Clerk access tokens for an mcp-use resource server.
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

/** Verified Clerk user and organization claims exposed to authenticated MCP callbacks. */
export interface ClerkOAuthUser {
  /** Clerk subject identifier. */
  id: string;
  /** Primary email address, when included in the access token. */
  email?: string;
  /** Display name, when included in the access token. */
  name?: string;
  /** Clerk username, when included in the access token. */
  username?: string;
  /** Profile image URL, when included in the access token. */
  picture?: string;
  /** Whether Clerk has verified {@link ClerkOAuthUser.email}. */
  emailVerified?: boolean;
  /** Active Clerk organization identifier. */
  organizationId?: string;
  /** Role in the active Clerk organization. */
  organizationRole?: string;
  /** Slug of the active Clerk organization. */
  organizationSlug?: string;
  /** Active organization role as a normalized list. */
  roles: string[];
}

/** Configures Clerk JWT verification and protected-resource metadata. */
export interface ClerkOAuthProviderOptions extends OAuthResourceOptions {
  /**
   * Clerk Frontend API URL used as the token issuer.
   *
   * @defaultValue `MCP_USE_OAUTH_CLERK_FRONTEND_API_URL`
   */
  frontendApiUrl?: URL | string;
  /** Expected Clerk access-token audience, when the application emits one. */
  audience?: string;
}

/**
 * Creates a provider that verifies Clerk access tokens and maps their claims.
 *
 * @param options - Clerk frontend API URL, optional token audience, and resource-server settings. Defaults to v1 environment variables.
 * @returns A provider that verifies Clerk-issued access tokens and explicit resource claims.
 * @throws An `Error` if no frontend API URL is configured, or a `TypeError` if it is invalid or `audience` is empty.
 *
 * @example
 * ```ts
 * import { oauthClerkProvider } from "mcp-use/oauth/clerk";
 *
 * const oauth = oauthClerkProvider({
 *   frontendApiUrl: "https://example.clerk.accounts.dev",
 * });
 * ```
 */
export function oauthClerkProvider(
  options: ClerkOAuthProviderOptions = {}
): DirectOAuthProvider<ClerkOAuthUser> {
  if (
    options.audience !== undefined &&
    (typeof options.audience !== "string" ||
      options.audience.trim().length === 0)
  ) {
    throw new TypeError("Clerk audience must be non-empty");
  }
  const frontendApiUrl =
    options.frontendApiUrl ??
    oauthEnvironmentValue("MCP_USE_OAUTH_CLERK_FRONTEND_API_URL");
  if (frontendApiUrl === undefined) {
    throw new Error("Clerk frontendApiUrl is required.");
  }
  const issuer = normalizedProviderUrl(
    frontendApiUrl,
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
