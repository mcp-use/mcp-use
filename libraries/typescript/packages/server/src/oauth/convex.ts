/**
 * Verify access tokens from the Convex OAuth Provider component.
 *
 * @packageDocumentation
 */

import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

import { oauthEnvironmentValue } from "./environment.js";
import {
  booleanValue,
  createJwtVerifier,
  invalidToken,
  normalizedProviderUrl,
  normalizedStrings,
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
  /** Convex subject identifier. */
  id: string;
  /** Primary email address, granted by the `email` scope. */
  email?: string;
  /** Whether Convex has verified {@link ConvexOAuthUser.email}. */
  emailVerified?: boolean;
  /** Display name, granted by the `profile` scope. */
  name?: string;
  /** Profile image URL, granted by the `profile` scope. */
  picture?: string;
  /** Registered OAuth client the token was issued to, from the `cid` claim. */
  clientId?: string;
}

/** Configures Convex JWT verification and protected-resource metadata. */
export interface ConvexOAuthProviderOptions extends OAuthResourceOptions {
  /**
   * Origin the OAuth component is mounted on, including its base path, such as
   * `https://example.convex.site/oauth`. Convex issues tokens whose `iss` is
   * this exact value, so the base path belongs here rather than in a separate
   * option.
   *
   * @defaultValue `MCP_USE_OAUTH_CONVEX_AUTH_URL`
   */
  authURL?: string;
  /** Scopes advertised in protected-resource metadata. */
  scopesSupported?: readonly string[];
}

/**
 * Creates a provider that verifies Convex access tokens and maps their claims.
 *
 * The component's Dynamic Client Registration is off by default, and MCP
 * clients rely on it to register themselves, so enable it in the Convex app
 * for the advertised `registration_endpoint` to work.
 *
 * @param options - Convex OAuth origin and resource-server settings.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 * @throws An `Error` if no auth URL is configured, or a `TypeError` if it is not a valid HTTPS origin.
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
        ? ["openid", "profile", "email"]
        : [...scopesSupported],
  };
}

function mapUser(authInfo: AuthInfo) {
  const payload = payloadFromAuthInfo(authInfo);
  const id = requiredString(payload, "sub");
  if (id === undefined) throw invalidToken("Missing Convex subject");
  return {
    user: {
      id,
      ...optional("email", stringValue(payload, "email")),
      ...optional("emailVerified", booleanValue(payload, "email_verified")),
      ...optional("name", stringValue(payload, "name")),
      ...optional("picture", stringValue(payload, "picture")),
      ...optional("clientId", stringValue(payload, "cid")),
    },
    payload,
    // Convex puts granted scopes in `scp`; the SDK's own `scopes` stays the
    // authoritative list, this mirrors them into permissions for callbacks.
    permissions: normalizedStrings(payload["scp"]),
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
