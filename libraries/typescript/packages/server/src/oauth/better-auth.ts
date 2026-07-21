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
  oauthEnvironmentValue,
  oauthCustomProvider,
  type OAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Verified Better Auth claims exposed to authenticated MCP callbacks. */
export interface BetterAuthOAuthUser {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
  emailVerified?: boolean;
  sessionId?: string;
  isAnonymous?: boolean;
  roles: string[];
}

/** Configures Better Auth JWT verification and protected-resource metadata. */
export interface BetterAuthOAuthProviderOptions extends OAuthResourceOptions {
  /** Full Better Auth issuer URL, including its base path. */
  authURL?: URL | string;
}

/**
 * Creates a provider for Better Auth's OAuth 2.1 Provider plugin.
 *
 * Better Auth owns registration, authorization, consent, and token issuance.
 * mcp-use advertises those endpoints and verifies the resulting access-token
 * JWTs against Better Auth's JWKS endpoint.
 *
 * @param options - Better Auth issuer URL and resource-server settings.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 */
export function oauthBetterAuthProvider(
  options: BetterAuthOAuthProviderOptions = {}
): OAuthProvider<BetterAuthOAuthUser> {
  const authURL =
    options.authURL ?? oauthEnvironmentValue("MCP_USE_OAUTH_BETTER_AUTH_URL");
  if (authURL === undefined) {
    throw new Error(
      "Better Auth authURL is required. Set MCP_USE_OAUTH_BETTER_AUTH_URL or pass authURL in config."
    );
  }
  const issuer = normalizedProviderUrl(
    authURL,
    "Better Auth authURL"
  ).href.replace(/\/$/, "");

  return oauthCustomProvider<BetterAuthOAuthUser>({
    ...options,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(providerEndpoint(issuer, "jwks")),
        resource,
      }),
    oauthMetadata: metadata(issuer, options.scopesSupported),
    mapAuthInfo: mapUser,
  });
}

function metadata(
  issuer: string,
  scopesSupported: readonly string[] | undefined
): OAuthMetadata {
  return {
    issuer,
    authorization_endpoint: providerEndpoint(issuer, "oauth2/authorize"),
    token_endpoint: providerEndpoint(issuer, "oauth2/token"),
    registration_endpoint: providerEndpoint(issuer, "oauth2/register"),
    jwks_uri: providerEndpoint(issuer, "jwks"),
    response_types_supported: ["code"],
    grant_types_supported: [
      "authorization_code",
      "client_credentials",
      "refresh_token",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported:
      scopesSupported === undefined
        ? ["openid", "profile", "email", "offline_access"]
        : [...scopesSupported],
  };
}

function mapUser(authInfo: AuthInfo) {
  const payload = payloadFromAuthInfo(authInfo);
  const id = requiredString(payload, "sub");
  if (id === undefined) throw invalidToken("Missing Better Auth subject");

  return {
    user: {
      id,
      ...optional("email", stringValue(payload, "email")),
      ...optional("name", stringValue(payload, "name")),
      ...optional("picture", stringValue(payload, "picture")),
      ...optional("emailVerified", booleanValue(payload, "email_verified")),
      ...optional("sessionId", stringValue(payload, "sid")),
      ...optional(
        "isAnonymous",
        booleanValue(payload, "is_anonymous") ??
          booleanValue(payload, "isAnonymous")
      ),
      roles: normalizedStrings(payload["roles"]),
    },
    payload,
    permissions: normalizedStrings(payload["permissions"]),
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
