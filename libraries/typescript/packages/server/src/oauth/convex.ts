/**
 * Verify access tokens from the Convex OAuth Provider component.
 *
 * @packageDocumentation
 */

import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

import { oauthEnvironmentValue } from "./environment.js";
import {
  createJwtVerifier,
  invalidToken,
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

/** Verified Convex claims exposed to authenticated MCP callbacks. */
export interface ConvexOAuthUser {
  /** Convex subject identifier from the access token's `sub` claim. */
  id: string;
  /**
   * Registered OAuth client the token was issued to, from the `cid` claim
   * (falls back to `client_id` when present).
   */
  clientId?: string;
}

/** Configures Convex JWT verification and protected-resource metadata. */
export interface ConvexOAuthProviderOptions extends OAuthResourceOptions {
  /**
   * Complete Convex OAuth issuer URL, including the mounted base path.
   *
   * @example `https://example.convex.site/oauth`
   * @defaultValue `MCP_USE_OAUTH_CONVEX_AUTH_URL`
   */
  authURL?: URL | string;
}

/**
 * Creates a provider that verifies Convex OAuth Provider access tokens.
 *
 * Convex owns registration, authorization, consent, and token issuance.
 * mcp-use advertises those endpoints and verifies the resulting access-token
 * JWTs against Convex's JWKS endpoint. Dynamic Client Registration is off by
 * default in the Convex component; enable it there so the advertised
 * `registration_endpoint` works for MCP clients.
 *
 * @param options - Convex issuer URL and resource-server settings. Defaults to v1 environment variables.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 * @throws An `Error` if no issuer URL is configured, or a `TypeError` if it is not a valid HTTP or HTTPS URL.
 *
 * @example
 * ```ts
 * import { oauthConvexProvider } from "mcp-use/oauth/convex";
 *
 * const oauth = oauthConvexProvider({
 *   authURL: "https://example.convex.site/oauth",
 * });
 * ```
 */
export function oauthConvexProvider(
  options: ConvexOAuthProviderOptions = {}
): OAuthProvider<ConvexOAuthUser> {
  const authURL =
    options.authURL ?? oauthEnvironmentValue("MCP_USE_OAUTH_CONVEX_AUTH_URL");
  if (authURL === undefined) {
    throw new Error("Convex authURL is required.");
  }
  const issuer = normalizedProviderUrl(authURL, "Convex authURL").href.replace(
    /\/$/,
    ""
  );

  return oauthCustomProvider<ConvexOAuthUser>({
    ...options,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(providerEndpoint(issuer, ".well-known/jwks.json")),
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
    authorization_endpoint: providerEndpoint(issuer, "authorize"),
    token_endpoint: providerEndpoint(issuer, "token"),
    registration_endpoint: providerEndpoint(issuer, "register"),
    jwks_uri: providerEndpoint(issuer, ".well-known/jwks.json"),
    userinfo_endpoint: providerEndpoint(issuer, "userinfo"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
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
  if (id === undefined) throw invalidToken("Missing Convex subject");
  const clientId =
    stringValue(payload, "cid") ?? stringValue(payload, "client_id");

  return {
    user: {
      id,
      ...optional("clientId", clientId),
    },
    payload,
    permissions: [],
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
