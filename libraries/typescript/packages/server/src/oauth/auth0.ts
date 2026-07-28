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

/** Verified Auth0 user claims exposed to authenticated MCP callbacks. */
export interface Auth0OAuthUser {
  id: string;
  email?: string;
  name?: string;
  nickname?: string;
  picture?: string;
  emailVerified?: boolean;
  updatedAt?: string;
  roles: string[];
}

/** Configures Auth0 JWT verification and protected-resource metadata. */
export interface Auth0OAuthProviderOptions extends OAuthResourceOptions {
  domain: URL | string;
}

/**
 * Creates a provider that verifies Auth0 access tokens and maps their claims.
 *
 * @param options - Auth0 domain and resource-server settings.
 * @returns A provider that rejects tokens not issued for the resolved MCP resource.
 */
export function oauthAuth0Provider(
  options: Auth0OAuthProviderOptions
): OAuthProvider<Auth0OAuthUser> {
  const issuer = normalizedProviderUrl(options.domain, "Auth0 domain").href;
  return oauthCustomProvider<Auth0OAuthUser>({
    ...options,
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
