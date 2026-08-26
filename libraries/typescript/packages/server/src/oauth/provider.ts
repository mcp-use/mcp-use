import type {
  AuthInfo as OAuthAuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import type { FetchMiddleware } from "../fetch-app.js";
import { assertSecureHttpUrl, parseAbsoluteUrl } from "./internal.js";

/** Additional verified identity information exposed by mcp-use callbacks. */
export type OAuthExtra<TUser> = Record<string, unknown> & {
  /** The authenticated application user. */
  user: TUser;
  /** Verified token claims or introspection data. */
  payload: Record<string, unknown>;
  /** Verified permissions granted to the user. */
  permissions: string[];
};

/** Resource-server metadata and bearer-gate configuration. */
export interface OAuthResourceOptions {
  /** Full canonical public MCP endpoint URL. */
  resource?: URL | string;
  /** Endpoint-wide scopes enforced by the SDK bearer gate. */
  requiredScopes?: readonly string[];
  /** Scopes advertised by protected-resource metadata. */
  scopesSupported?: readonly string[];
  /** Human-readable name advertised by protected-resource metadata. */
  resourceName?: string;
  /** Documentation URL advertised by protected-resource metadata. */
  serviceDocumentationUrl?: URL;
}

/** Options for {@link oauthCustomProvider}. */
export interface CustomOAuthProviderOptions<
  TUser,
> extends OAuthResourceOptions {
  /** Creates a verifier bound to the resolved canonical MCP resource. */
  createTokenVerifier: (resource: URL) => OAuthTokenVerifier;
  /** RFC 8414 metadata for the external authorization server. */
  oauthMetadata: OAuthMetadata;
  /** Maps verified SDK auth information into mcp-use callback identity data. */
  mapAuthInfo: (authInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
}

/** Effective OAuth behavior returned after a provider binds to a resource. */
export interface OAuthProviderBinding<TUser> {
  /** RFC 8414 metadata effective for the resolved resource. */
  readonly oauthMetadata: OAuthMetadata;
  /** Raw token verifier bound to the resolved resource. */
  readonly tokenVerifier: OAuthTokenVerifier;
  /** Maps verified SDK auth information into mcp-use callback identity data. */
  readonly mapAuthInfo: (authInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
  /** Endpoint-wide scopes enforced by the SDK bearer gate. */
  readonly requiredScopes?: readonly string[];
  /** Scopes advertised by protected-resource metadata. */
  readonly scopesSupported?: readonly string[];
  /** Human-readable name advertised by protected-resource metadata. */
  readonly resourceName?: string;
  /** Documentation URL advertised by protected-resource metadata. */
  readonly serviceDocumentationUrl?: URL;
  /** Provider-owned HTTP middleware installed for this resource. */
  readonly middleware?: FetchMiddleware;
}

/** Legacy provider whose metadata and verifier factory are known up front. */
export type DirectOAuthProvider<TUser> = CustomOAuthProviderOptions<TUser>;

/** Provider whose effective behavior is resolved from the canonical resource. */
export interface ResourceBoundOAuthProvider<
  TUser,
> extends OAuthResourceOptions {
  /** Resolves resource-dependent OAuth behavior for one server mount. */
  readonly bind: (resource: URL) => OAuthProviderBinding<TUser>;
}

/** OAuth resource-server provider accepted by the mcp-use server constructor. */
export type OAuthProvider<TUser> =
  | DirectOAuthProvider<TUser>
  | ResourceBoundOAuthProvider<TUser>;

/** OAuth provider state bound to one canonical MCP resource. @internal */
export interface BoundOAuthProvider<TUser> {
  /** Canonical protected-resource identity for this server mount. */
  readonly resource: URL;
  /** Effective RFC 8414 metadata snapshotted at bind time. */
  readonly oauthMetadata: OAuthMetadata;
  /** Raw provider verifier created for {@link resource}. */
  readonly tokenVerifier: OAuthTokenVerifier;
  /** Effective verified-identity mapper snapshotted at bind time. */
  readonly mapAuthInfo: (authInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
  /** Effective endpoint-wide bearer scopes. */
  readonly requiredScopes?: readonly string[];
  /** Effective protected-resource metadata scopes. */
  readonly scopesSupported?: readonly string[];
  /** Effective protected-resource display name. */
  readonly resourceName?: string;
  /** Effective protected-resource documentation URL. */
  readonly serviceDocumentationUrl?: URL;
  /** Effective provider-owned HTTP middleware. */
  readonly middleware?: FetchMiddleware;
}

/**
 * Creates an OAuth provider backed by an external authorization server.
 *
 * @typeParam TUser - Application user type exposed to authenticated callbacks.
 * @param options - Token verification, discovery metadata, and identity mapping.
 * @returns A provider for an OAuth-enabled MCP server.
 * @throws A `TypeError` if provider metadata or resource settings are invalid.
 *
 * @example
 * ```ts
 * import { oauthCustomProvider } from "mcp-use/oauth";
 *
 * const oauth = oauthCustomProvider({
 *   createTokenVerifier: (resource) => tokenVerifierFor(resource),
 *   oauthMetadata,
 *   mapAuthInfo: (authInfo) => ({
 *     user: { id: authInfo.clientId },
 *     payload: {},
 *     permissions: [],
 *   }),
 * });
 * ```
 */
export function oauthCustomProvider<TUser>(
  options: CustomOAuthProviderOptions<TUser>
): DirectOAuthProvider<TUser> {
  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.createTokenVerifier !== "function" ||
    typeof options.mapAuthInfo !== "function"
  ) {
    throw new TypeError(
      "oauthCustomProvider requires createTokenVerifier, oauthMetadata, and mapAuthInfo"
    );
  }

  assertOAuthMetadata(options.oauthMetadata);
  if (options.resource !== undefined) {
    assertResourceUrl(options.resource);
  }
  assertStringArray(options.requiredScopes, "requiredScopes");
  assertStringArray(options.scopesSupported, "scopesSupported");
  if (
    options.resourceName !== undefined &&
    (typeof options.resourceName !== "string" ||
      options.resourceName.trim().length === 0)
  ) {
    throw new TypeError("resourceName must be a non-empty string");
  }
  if (options.serviceDocumentationUrl !== undefined) {
    if (!(options.serviceDocumentationUrl instanceof URL)) {
      throw new TypeError("serviceDocumentationUrl must be a URL");
    }
    assertSecureHttpUrl(
      options.serviceDocumentationUrl,
      "serviceDocumentationUrl"
    );
  }

  const provider: DirectOAuthProvider<TUser> = {
    createTokenVerifier: options.createTokenVerifier,
    oauthMetadata: options.oauthMetadata,
    mapAuthInfo: options.mapAuthInfo,
    ...(options.resource !== undefined && { resource: options.resource }),
    ...(options.requiredScopes !== undefined && {
      requiredScopes: [...options.requiredScopes],
    }),
    ...(options.scopesSupported !== undefined && {
      scopesSupported: [...options.scopesSupported],
    }),
    ...(options.resourceName !== undefined && {
      resourceName: options.resourceName,
    }),
    ...(options.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: options.serviceDocumentationUrl,
    }),
  };
  return provider;
}

function assertOAuthMetadata(
  metadata: unknown
): asserts metadata is OAuthMetadata {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("issuer" in metadata) ||
    typeof metadata.issuer !== "string"
  ) {
    throw new TypeError("oauthMetadata must include a string issuer");
  }
  assertSecureHttpUrl(
    parseAbsoluteUrl(metadata.issuer, "oauthMetadata.issuer"),
    "oauthMetadata.issuer"
  );
}

function assertResourceUrl(resource: URL | string): void {
  assertSecureHttpUrl(parseAbsoluteUrl(resource, "resource"), "resource");
}

function assertStringArray(
  value: readonly string[] | undefined,
  name: string
): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
  ) {
    throw new TypeError(`${name} must be an array of strings`);
  }
}
