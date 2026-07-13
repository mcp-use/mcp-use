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

/** Verified WorkOS user and organization claims exposed to authenticated MCP callbacks. */
export interface WorkOSOAuthUser {
  id: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  preferredUsername?: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
  roles: string[];
  organizationId?: string;
  sessionId?: string;
}

/** Configures WorkOS JWT verification and protected-resource metadata. */
export interface WorkOSOAuthProviderOptions extends OAuthResourceOptions {
  subdomain: string;
  audience?: string;
}

/**
 * Creates a provider that verifies WorkOS access tokens and maps their claims.
 *
 * @param options - WorkOS AuthKit origin, optional audience, and resource-server settings.
 * @returns A provider that rejects tokens without a valid WorkOS signature and issuer.
 */
export function oauthWorkOSProvider(
  options: WorkOSOAuthProviderOptions
): OAuthProvider<WorkOSOAuthUser> {
  if (
    options.audience !== undefined &&
    (typeof options.audience !== "string" ||
      options.audience.trim().length === 0)
  ) {
    throw new TypeError("WorkOS audience must be non-empty");
  }
  const issuer = workosIssuer(options.subdomain);
  return oauthCustomProvider<WorkOSOAuthUser>({
    ...options,
    tokenVerifier: createJwtVerifier({
      issuer,
      jwksUrl: new URL(providerEndpoint(issuer, "oauth2/jwks")),
      ...(options.audience !== undefined && { audience: options.audience }),
      resource: options.resource,
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
