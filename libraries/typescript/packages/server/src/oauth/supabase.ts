/**
 * Verify Supabase access tokens for an mcp-use resource server.
 *
 * @packageDocumentation
 */

import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

import { oauthEnvironmentValue } from "./environment.js";
import { isRecord } from "./guards.js";
import {
  createJwtVerifier,
  invalidToken,
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

/** Verified Supabase user claims exposed to authenticated MCP callbacks. */
export interface SupabaseOAuthUser {
  /** Supabase user identifier. */
  id: string;
  /** Primary email address, when included in the access token. */
  email?: string;
  /** Display name from `user_metadata.name`. */
  name?: string;
  /** Full name from `user_metadata.full_name`. */
  fullName?: string;
  /** Username from `user_metadata.username`. */
  username?: string;
  /** Profile image URL from `user_metadata.avatar_url`. */
  avatarUrl?: string;
  /** Supabase Postgres role from the access token. */
  role?: string;
  /** Authenticator assurance level for the session. */
  aal?: string;
  /** Authentication methods used for the session. */
  amr: SupabaseAmr[];
  /** Supabase session identifier. */
  sessionId?: string;
}

/** A verified Supabase authentication-method reference. */
export interface SupabaseAmr {
  /** Authentication method name, such as `password` or `totp`. */
  method: string;
  /** Unix timestamp at which the authentication method was completed. */
  timestamp?: number;
}

/** Configures Supabase JWT verification and protected-resource metadata. */
export interface SupabaseOAuthProviderOptions extends OAuthResourceOptions {
  /**
   * Supabase project identifier used to derive `supabaseUrl`.
   *
   * @defaultValue `MCP_USE_OAUTH_SUPABASE_PROJECT_ID`
   */
  projectId?: string;
  /**
   * Full Supabase project URL. Takes precedence over `projectId`.
   *
   * @defaultValue `MCP_USE_OAUTH_SUPABASE_URL`
   */
  supabaseUrl?: URL | string;
  /**
   * Legacy HS256 JWT secret. Omit to verify ES256 tokens against project JWKS.
   *
   * @defaultValue `MCP_USE_OAUTH_SUPABASE_JWT_SECRET`
   */
  jwtSecret?: string;
  /**
   * Expected access-token audience.
   *
   * @defaultValue `"authenticated"`
   */
  audience?: string;
}

/**
 * Creates a provider that verifies Supabase access tokens and maps their claims.
 *
 * @param options - Supabase project or URL, optional JWT secret/audience, and resource-server settings. Defaults to v1 environment variables.
 * @returns A provider that rejects tokens without a valid configured Supabase signature and issuer.
 * @throws A `TypeError` if project settings are invalid, `audience` is empty,
 * or `jwtSecret` is shorter than 32 bytes.
 *
 * @example
 * ```ts
 * import { oauthSupabaseProvider } from "mcp-use/oauth/supabase";
 *
 * const oauth = oauthSupabaseProvider({
 *   projectId: "example-project",
 * });
 * ```
 */
export function oauthSupabaseProvider(
  options: SupabaseOAuthProviderOptions = {}
): DirectOAuthProvider<SupabaseOAuthUser> {
  const projectId =
    options.projectId ??
    oauthEnvironmentValue("MCP_USE_OAUTH_SUPABASE_PROJECT_ID");
  const configuredSupabaseUrl =
    options.supabaseUrl ?? oauthEnvironmentValue("MCP_USE_OAUTH_SUPABASE_URL");
  const jwtSecret =
    options.jwtSecret ??
    oauthEnvironmentValue("MCP_USE_OAUTH_SUPABASE_JWT_SECRET");
  const resolvedOptions = {
    ...options,
    ...(projectId !== undefined && { projectId }),
    ...(configuredSupabaseUrl !== undefined && {
      supabaseUrl: configuredSupabaseUrl,
    }),
    ...(jwtSecret !== undefined && { jwtSecret }),
  };
  const supabaseUrl = resolveSupabaseUrl(resolvedOptions);
  const issuer = providerEndpoint(supabaseUrl, "auth/v1").replace(/\/$/, "");
  const secret = resolvedOptions.jwtSecret;
  const audience = resolvedOptions.audience ?? "authenticated";
  if (typeof audience !== "string" || audience.trim().length === 0) {
    throw new TypeError("Supabase audience must be non-empty");
  }
  if (secret !== undefined && new TextEncoder().encode(secret).length < 32) {
    throw new TypeError("Supabase jwtSecret must be at least 32 bytes");
  }
  return oauthCustomProvider<SupabaseOAuthUser>({
    ...resolvedOptions,
    createTokenVerifier: (resource) =>
      createJwtVerifier({
        issuer,
        jwksUrl: new URL(
          providerEndpoint(supabaseUrl, "auth/v1/.well-known/jwks.json")
        ),
        ...(secret !== undefined
          ? { key: new TextEncoder().encode(secret), algorithms: ["HS256"] }
          : { algorithms: ["ES256"] }),
        resource,
        audience,
      }),
    oauthMetadata: {
      issuer,
      authorization_endpoint: providerEndpoint(
        supabaseUrl,
        "auth/v1/oauth/authorize"
      ),
      token_endpoint: providerEndpoint(supabaseUrl, "auth/v1/oauth/token"),
      registration_endpoint: providerEndpoint(
        supabaseUrl,
        "auth/v1/oauth/clients/register"
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
  const id =
    requiredString(payload, "sub") ?? requiredString(payload, "user_id");
  if (id === undefined) throw invalidToken("Missing Supabase subject");
  const userMetadata = recordValue(payload, "user_metadata") ?? {};
  const aal = stringValue(payload, "aal");
  return {
    user: {
      id,
      ...optional("email", stringValue(payload, "email")),
      ...optional("name", stringValue(userMetadata, "name")),
      ...optional("fullName", stringValue(userMetadata, "full_name")),
      ...optional("username", stringValue(userMetadata, "username")),
      ...optional("avatarUrl", stringValue(userMetadata, "avatar_url")),
      ...optional("role", stringValue(payload, "role")),
      ...optional("aal", aal),
      amr: supabaseAmr(payload["amr"]),
      ...optional("sessionId", stringValue(payload, "session_id")),
    },
    payload,
    permissions: aal === undefined ? [] : [`aal:${aal}`],
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function resolveSupabaseUrl(options: SupabaseOAuthProviderOptions): URL {
  if (options.supabaseUrl !== undefined) {
    return normalizedProviderUrl(options.supabaseUrl, "supabaseUrl");
  }
  if (
    options.projectId === undefined ||
    !/^[a-z0-9-]+$/i.test(options.projectId)
  ) {
    throw new TypeError("Supabase requires projectId or supabaseUrl");
  }
  return new URL(`https://${options.projectId}.supabase.co`);
}

function supabaseAmr(value: unknown): SupabaseAmr[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SupabaseAmr[] => {
    if (!isRecord(item)) return [];
    const method = item["method"];
    const timestamp = item["timestamp"];
    if (typeof method !== "string" || method.length === 0) return [];
    if (
      timestamp !== undefined &&
      (typeof timestamp !== "number" || !Number.isFinite(timestamp))
    ) {
      return [];
    }
    return [timestamp === undefined ? { method } : { method, timestamp }];
  });
}
