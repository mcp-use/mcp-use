/**
 * Verify MCPBundles Connect Auth access tokens for an mcp-use resource server.
 *
 * @packageDocumentation
 */

import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";
import { errors } from "jose";

import { isRecord } from "./guards.js";
import {
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
  type OAuthExtra,
  type OAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Tenant public-config returned by the MCPBundles Connect Auth API. */
export interface McpbundlesPublicConfig {
  /** Tenant authorization-server issuer URL. */
  issuer: string;
  /** Scopes advertised for this listing. */
  scopes_supported: string[];
  /** Canonical vendor MCP origin resource URL. */
  origin_resource: string;
  /** MCPBundles bundle proxy resource URL. */
  bundle_proxy_resource: string;
  /** Optional origin telemetry ingest URL. */
  telemetry_ingest_url?: string;
}

/** Verified Connect Auth identity exposed to authenticated MCP callbacks. */
export interface McpbundlesOAuthUser {
  /** Connect Auth subject identifier. */
  id: string;
  /** Organization identifier, when present in the access token. */
  organizationId?: string;
  /** Primary email from federation, when passed at `complete` and minted on the token. */
  email?: string;
  /** Role names from federation, when passed at `complete` and minted on the token. */
  roles: string[];
}

/** Configures MCPBundles JWT verification and protected-resource metadata. */
export interface McpbundlesOAuthProviderOptions extends OAuthResourceOptions {
  /** Published `/skills` listing slug (Connect Auth tenant id). */
  listingSlug: string;
  /** Public vendor MCP origin URL (must match listing `origin_resource`). */
  baseUrl: URL | string;
  /** API host for tenant routes. Default: {@link DEFAULT_MCPBUNDLES_API_BASE_URL}. */
  apiBaseUrl?: string;
  /** Preloaded public-config from {@link fetchMcpbundlesPublicConfig}. */
  publicConfig?: McpbundlesPublicConfig;
}

/** Options for {@link fetchMcpbundlesPublicConfig}. */
export interface FetchMcpbundlesPublicConfigOptions {
  /** Published `/skills` listing slug. */
  listingSlug: string;
  /** API host override. Default: {@link DEFAULT_MCPBUNDLES_API_BASE_URL}. */
  apiBaseUrl?: string;
  /** Fetch implementation for tests. */
  fetch?: typeof globalThis.fetch;
  /** Optional abort signal. */
  signal?: AbortSignal;
  /** HTTP timeout in seconds. Default: 10. */
  timeoutSeconds?: number;
}

/** Raised when tenant public-config cannot be fetched or parsed. */
export class McpbundlesPublicConfigError extends Error {
  /** Listing slug from the request. */
  readonly listingSlug: string;
  /** Request URL that failed. */
  readonly url: string;
  /** Short machine-readable failure reason. */
  readonly reason: string;

  /** Creates a public-config fetch or validation error. */
  constructor(options: {
    listingSlug: string;
    url: string;
    reason: string;
    cause?: unknown;
  }) {
    super(
      `Failed to load MCP Connect Auth public-config for listing "${options.listingSlug}" from ${options.url}: ${options.reason}. See ${MCPBUNDLES_INTEGRATION_DOC_URL}`
    );
    this.name = "McpbundlesPublicConfigError";
    this.listingSlug = options.listingSlug;
    this.url = options.url;
    this.reason = options.reason;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** MCPBundles Connect Auth integration reference documentation. */
export const MCPBUNDLES_INTEGRATION_DOC_URL =
  "https://www.mcpbundles.com/docs/integrations/mcp-connect-auth";

/** Default MCPBundles API base URL. */
export const DEFAULT_MCPBUNDLES_API_BASE_URL = "https://api.mcpbundles.com";

const DEFAULT_PUBLIC_CONFIG_TIMEOUT_SECONDS = 10;

/**
 * Resolves the tenant authorization-server base URL.
 *
 * @param listingSlug - Published listing slug.
 * @param apiBaseUrl - Optional API host override.
 * @returns Tenant Connect Auth base URL without a trailing slash.
 */
export function tenantBaseUrl(
  listingSlug: string,
  apiBaseUrl?: string
): string {
  const slug = normalizeListingSlug(listingSlug);
  return `${resolveApiBaseUrl(apiBaseUrl)}/connect-auth/tenants/${encodeURIComponent(slug)}`;
}

/**
 * Resolves the tenant public-config URL.
 *
 * @param listingSlug - Published listing slug.
 * @param apiBaseUrl - Optional API host override.
 * @returns Public-config URL.
 */
export function publicConfigUrl(
  listingSlug: string,
  apiBaseUrl?: string
): string {
  return `${tenantBaseUrl(listingSlug, apiBaseUrl)}/public-config`;
}

/**
 * Resolves the tenant JWKS URL.
 *
 * @param listingSlug - Published listing slug.
 * @param apiBaseUrl - Optional API host override.
 * @returns JWKS URL.
 */
export function jwksUrl(listingSlug: string, apiBaseUrl?: string): string {
  return `${tenantBaseUrl(listingSlug, apiBaseUrl)}/.well-known/jwks.json`;
}

/**
 * Fetches and validates tenant public-config.
 *
 * @param options - Listing slug and optional fetch overrides.
 * @returns Parsed public-config.
 * @throws {@link McpbundlesPublicConfigError} when the request or payload is invalid.
 */
export async function fetchMcpbundlesPublicConfig(
  options: FetchMcpbundlesPublicConfigOptions
): Promise<McpbundlesPublicConfig> {
  const listingSlug = normalizeListingSlug(options.listingSlug);
  const url = publicConfigUrl(listingSlug, options.apiBaseUrl);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutSeconds =
    options.timeoutSeconds ?? DEFAULT_PUBLIC_CONFIG_TIMEOUT_SECONDS;
  const signal = options.signal ?? AbortSignal.timeout(timeoutSeconds * 1000);

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    throw new McpbundlesPublicConfigError({
      listingSlug,
      url,
      reason: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  if (!response.ok) {
    throw new McpbundlesPublicConfigError({
      listingSlug,
      url,
      reason: `HTTP ${response.status}`,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new McpbundlesPublicConfigError({
      listingSlug,
      url,
      reason: "response was not valid JSON",
      cause: error,
    });
  }

  return parsePublicConfig(payload, listingSlug, url);
}

/**
 * Creates a provider that verifies MCPBundles Connect Auth access tokens.
 *
 * @param options - Listing slug, vendor origin URL, and preloaded public-config.
 * @returns A DCR-direct provider backed by the tenant authorization server.
 * @throws A `TypeError` when required options or public-config are invalid.
 *
 * @example
 * ```ts
 * import {
 *   fetchMcpbundlesPublicConfig,
 *   oauthMcpbundlesProvider,
 * } from "mcp-use/oauth/mcpbundles";
 *
 * const listingSlug = "my-listing";
 * const publicConfig = await fetchMcpbundlesPublicConfig({ listingSlug });
 *
 * const oauth = oauthMcpbundlesProvider({
 *   listingSlug,
 *   baseUrl: "https://mcp.example.com",
 *   publicConfig,
 * });
 * ```
 */
export function oauthMcpbundlesProvider(
  options: McpbundlesOAuthProviderOptions
): OAuthProvider<McpbundlesOAuthUser> {
  const listingSlug = normalizeListingSlug(options.listingSlug);
  const apiBaseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  const publicConfig = options.publicConfig;
  if (publicConfig === undefined) {
    throw new TypeError(
      "publicConfig is required; await fetchMcpbundlesPublicConfig({ listingSlug }) before constructing oauthMcpbundlesProvider()"
    );
  }

  const normalizedBaseUrl = normalizeResourceUrl(options.baseUrl, "baseUrl");
  const normalizedOrigin = normalizeResourceUrl(
    publicConfig.origin_resource,
    "origin_resource"
  );
  if (normalizedBaseUrl !== normalizedOrigin) {
    throw new TypeError(
      `baseUrl (${normalizedBaseUrl}) does not match listing origin_resource (${normalizedOrigin})`
    );
  }

  const expectedIssuer = tenantBaseUrl(listingSlug, apiBaseUrl);
  if (
    normalizeIssuer(publicConfig.issuer) !== normalizeIssuer(expectedIssuer)
  ) {
    throw new TypeError(
      `public-config issuer (${publicConfig.issuer}) does not match tenant base URL (${expectedIssuer})`
    );
  }

  const tenantBase = expectedIssuer;
  const audiences = audiencesFromPublicConfig(publicConfig);
  const oauthMetadata = buildTenantOAuthMetadata(
    tenantBase,
    publicConfig.scopes_supported
  );
  const documentationUrl = new URL(MCPBUNDLES_INTEGRATION_DOC_URL);

  return oauthCustomProvider<McpbundlesOAuthUser>({
    ...options,
    resource: options.resource ?? normalizedBaseUrl,
    scopesSupported: options.scopesSupported ?? [
      ...publicConfig.scopes_supported,
    ],
    serviceDocumentationUrl:
      options.serviceDocumentationUrl ?? documentationUrl,
    createTokenVerifier: (resource) =>
      createMcpbundlesJwtVerifier({
        issuer: publicConfig.issuer,
        jwksUrl: new URL(jwksUrl(listingSlug, apiBaseUrl)),
        resource,
        audiences,
      }),
    oauthMetadata,
    mapAuthInfo: mapMcpbundlesUser,
  });
}

function parsePublicConfig(
  payload: unknown,
  listingSlug: string,
  url: string
): McpbundlesPublicConfig {
  if (!isRecord(payload)) {
    throw new McpbundlesPublicConfigError({
      listingSlug,
      url,
      reason: "response must be a JSON object",
    });
  }

  const missing: string[] = [];
  for (const field of [
    "issuer",
    "origin_resource",
    "bundle_proxy_resource",
  ] as const) {
    if (!isNonEmptyString(payload[field])) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new McpbundlesPublicConfigError({
      listingSlug,
      url,
      reason: `missing required fields: ${missing.join(", ")}`,
    });
  }

  const scopes = payload["scopes_supported"];
  let scopesSupported: string[];
  if (scopes === undefined) {
    scopesSupported = [];
  } else if (
    Array.isArray(scopes) &&
    scopes.every((scope) => typeof scope === "string")
  ) {
    scopesSupported = [...scopes];
  } else {
    throw new McpbundlesPublicConfigError({
      listingSlug,
      url,
      reason: "scopes_supported must be a string array",
    });
  }

  const config: McpbundlesPublicConfig = {
    issuer: payload["issuer"] as string,
    origin_resource: payload["origin_resource"] as string,
    bundle_proxy_resource: payload["bundle_proxy_resource"] as string,
    scopes_supported: scopesSupported,
  };

  const telemetryIngestUrl = payload["telemetry_ingest_url"];
  if (isNonEmptyString(telemetryIngestUrl)) {
    config.telemetry_ingest_url = telemetryIngestUrl;
  }

  return config;
}

function buildTenantOAuthMetadata(
  tenantBase: string,
  scopesSupported: readonly string[]
): OAuthMetadata {
  return {
    issuer: tenantBase,
    authorization_endpoint: providerEndpoint(tenantBase, "o/authorize/"),
    token_endpoint: providerEndpoint(tenantBase, "o/token/"),
    registration_endpoint: providerEndpoint(tenantBase, "o/register/"),
    revocation_endpoint: providerEndpoint(tenantBase, "o/revoke/"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: [...scopesSupported],
  } satisfies OAuthMetadata;
}

function createMcpbundlesJwtVerifier(options: {
  issuer: string;
  jwksUrl: URL;
  resource: URL;
  audiences: string[];
}): ReturnType<typeof createJwtVerifier> {
  let verifier = buildMcpbundlesJwtVerifier(options);
  return {
    async verifyAccessToken(token) {
      try {
        return await verifier.verifyAccessToken(token);
      } catch (error) {
        if (isJwksKidMiss(error)) {
          verifier = buildMcpbundlesJwtVerifier(options);
          return verifier.verifyAccessToken(token);
        }
        throw error;
      }
    },
  };
}

function buildMcpbundlesJwtVerifier(options: {
  issuer: string;
  jwksUrl: URL;
  resource: URL;
  audiences: string[];
}) {
  return createJwtVerifier({
    issuer: options.issuer,
    jwksUrl: options.jwksUrl,
    resource: options.resource,
    audience: options.audiences,
    algorithms: ["ES256"],
  });
}

function mapMcpbundlesUser(
  authInfo: AuthInfo
): OAuthExtra<McpbundlesOAuthUser> {
  const payload = payloadFromAuthInfo(authInfo);
  const id = requiredString(payload, "sub");
  if (id === undefined) {
    throw invalidToken("Missing Connect Auth subject");
  }
  const organizationId = stringValue(payload, "organization_id");
  const email = stringValue(payload, "email");
  return {
    user: {
      id,
      ...(organizationId !== undefined ? { organizationId } : {}),
      ...(email !== undefined ? { email } : {}),
      roles: normalizedStrings(payload["roles"]),
    },
    payload,
    permissions: [],
  };
}

function audiencesFromPublicConfig(config: McpbundlesPublicConfig): string[] {
  return [
    normalizeResourceUrl(config.origin_resource, "origin_resource"),
    normalizeResourceUrl(config.bundle_proxy_resource, "bundle_proxy_resource"),
  ];
}

function normalizeListingSlug(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("listingSlug is required");
  }
  return value.trim();
}

function resolveApiBaseUrl(apiBaseUrl?: string): string {
  return (apiBaseUrl ?? DEFAULT_MCPBUNDLES_API_BASE_URL).replace(/\/+$/, "");
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeResourceUrl(value: URL | string, name: string): string {
  const url = normalizedProviderUrl(value, name);
  url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJwksKidMiss(error: unknown): boolean {
  if (error instanceof errors.JWKSNoMatchingKey) {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    (error as { cause?: unknown }).cause instanceof errors.JWKSNoMatchingKey
  ) {
    return true;
  }
  if (
    error instanceof Error &&
    (error.message.includes("no applicable key") ||
      error.message.includes("unknown kid"))
  ) {
    return true;
  }
  return false;
}
