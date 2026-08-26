/**
 * Verify WorkOS AuthKit access tokens for an mcp-use resource server.
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

/** Verified WorkOS user and organization claims exposed to authenticated MCP callbacks. */
export interface WorkOSOAuthUser {
  /** WorkOS subject identifier. */
  id: string;
  /** Primary email address, when included in the access token. */
  email?: string;
  /** Whether WorkOS has verified {@link WorkOSOAuthUser.email}. */
  emailVerified?: boolean;
  /** Display name, when included in the access token. */
  name?: string;
  /** Preferred username, when included in the access token. */
  preferredUsername?: string;
  /** Given name, when included in the access token. */
  firstName?: string;
  /** Family name, when included in the access token. */
  lastName?: string;
  /** Profile image URL, when included in the access token. */
  picture?: string;
  /** Roles from the access token's `roles` claim. */
  roles: string[];
  /** Active WorkOS organization identifier. */
  organizationId?: string;
  /** WorkOS session identifier. */
  sessionId?: string;
}

/** Configures WorkOS JWT verification and protected-resource metadata. */
export interface WorkOSOAuthProviderOptions extends OAuthResourceOptions {
  /**
   * AuthKit subdomain, with or without the `https://` scheme.
   *
   * @defaultValue `MCP_USE_OAUTH_WORKOS_SUBDOMAIN`
   */
  subdomain?: string;
}

/**
 * Creates a provider that verifies WorkOS access tokens and maps their claims.
 *
 * @param options - WorkOS AuthKit origin and resource-server settings. Defaults to v1 environment variables.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 * @throws An `Error` if no subdomain is configured, or a `TypeError` if it is empty or uses a non-HTTPS URL.
 *
 * @example
 * ```ts
 * import { oauthWorkOSProvider } from "mcp-use/oauth/workos";
 *
 * const oauth = oauthWorkOSProvider({
 *   subdomain: "example.authkit.app",
 * });
 * ```
 */
export function oauthWorkOSProvider(
  options: WorkOSOAuthProviderOptions = {}
): DirectOAuthProvider<WorkOSOAuthUser> {
  const subdomain =
    options.subdomain ??
    oauthEnvironmentValue("MCP_USE_OAUTH_WORKOS_SUBDOMAIN");
  if (subdomain === undefined) {
    throw new Error("WorkOS subdomain is required.");
  }
  const issuer = workosIssuer(subdomain);
  return oauthCustomProvider<WorkOSOAuthUser>({
    ...options,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(providerEndpoint(issuer, "oauth2/jwks")),
        resource,
      }),
    oauthMetadata: {
      issuer,
      authorization_endpoint: providerEndpoint(issuer, "oauth2/authorize"),
      token_endpoint: providerEndpoint(issuer, "oauth2/token"),
      registration_endpoint: providerEndpoint(issuer, "oauth2/register"),
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
  if (id === undefined) throw invalidToken("Missing WorkOS subject");
  return {
    user: {
      id,
      ...optional("email", stringValue(payload, "email")),
      ...optional("emailVerified", booleanValue(payload, "email_verified")),
      ...optional("name", stringValue(payload, "name")),
      ...optional(
        "preferredUsername",
        stringValue(payload, "preferred_username")
      ),
      ...optional("firstName", stringValue(payload, "first_name")),
      ...optional("lastName", stringValue(payload, "last_name")),
      ...optional("picture", stringValue(payload, "picture")),
      roles: normalizedStrings(payload["roles"]),
      ...optional("organizationId", stringValue(payload, "org_id")),
      ...optional("sessionId", stringValue(payload, "sid")),
    },
    payload,
    permissions: normalizedStrings(payload["permissions"]),
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function workosIssuer(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("WorkOS subdomain is required");
  }
  const url = normalizedProviderUrl(value, "WorkOS subdomain");
  if (url.pathname !== "/") {
    throw new TypeError("WorkOS subdomain must be a hostname or HTTPS origin");
  }
  return url.href.replace(/\/$/, "");
}
