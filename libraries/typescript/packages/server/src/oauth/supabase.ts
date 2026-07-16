import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

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
  type OAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Verified Supabase user claims exposed to authenticated MCP callbacks. */
export interface SupabaseOAuthUser {
  id: string;
  email?: string;
  name?: string;
  fullName?: string;
  username?: string;
  avatarUrl?: string;
  role?: string;
  aal?: string;
  amr: SupabaseAmr[];
  sessionId?: string;
}

/** A verified Supabase authentication-method reference. */
export interface SupabaseAmr {
  method: string;
  timestamp?: number;
}

/** Configures Supabase JWT verification and protected-resource metadata. */
export interface SupabaseOAuthProviderOptions extends OAuthResourceOptions {
  projectId?: string;
  supabaseUrl?: URL | string;
  jwtSecret?: string;
}

/**
 * Creates a provider that verifies Supabase access tokens and maps their claims.
 *
 * @param options - Supabase project or URL, optional JWT secret, and resource-server settings.
 * @returns A provider that rejects tokens without a valid configured Supabase signature and issuer.
 */
export function oauthSupabaseProvider(
  options: SupabaseOAuthProviderOptions
): OAuthProvider<SupabaseOAuthUser> {
  const supabaseUrl = resolveSupabaseUrl(options);
  const issuer = providerEndpoint(supabaseUrl, "auth/v1").replace(/\/$/, "");
  const secret = options.jwtSecret;
  if (secret !== undefined && new TextEncoder().encode(secret).length < 32) {
    throw new TypeError("Supabase jwtSecret must be at least 32 bytes");
  }
  return oauthCustomProvider<SupabaseOAuthUser>({
    ...options,
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
