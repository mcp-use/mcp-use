import type {
  AuthInfo as OAuthAuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import {
  assertSecureHttpUrl,
  parseAbsoluteUrl,
} from "./internal.js";

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
  /** Verifies access tokens issued by the external authorization server. */
  tokenVerifier: OAuthTokenVerifier;
  /** RFC 8414 metadata for the external authorization server. */
  oauthMetadata: OAuthMetadata;
  /** Maps verified SDK auth information into mcp-use callback identity data. */
  mapAuthInfo: (authInfo: OAuthAuthInfo) => OAuthExtra<TUser>;
}

/** OAuth resource-server provider accepted by {@link MCPServer}. */
export interface OAuthProvider<TUser>
  extends CustomOAuthProviderOptions<TUser> {}

/**
 * Creates an OAuth provider backed by an external authorization server.
 *
 * @typeParam TUser - Application user type exposed to authenticated callbacks.
 * @param options - Token verification, discovery metadata, and identity mapping.
 * @returns A provider for an OAuth-enabled MCP server.
 */
export function oauthCustomProvider<TUser>(
  options: CustomOAuthProviderOptions<TUser>
): OAuthProvider<TUser> {
  if (
    options === null ||
    typeof options !== "object" ||
    options.tokenVerifier === null ||
    typeof options.tokenVerifier !== "object" ||
    typeof options.tokenVerifier.verifyAccessToken !== "function" ||
    typeof options.mapAuthInfo !== "function"
  ) {
    throw new TypeError(
      "oauthCustomProvider requires tokenVerifier, oauthMetadata, and mapAuthInfo"
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

  const provider: OAuthProvider<TUser> = {
    tokenVerifier: options.tokenVerifier,
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
