import type {
  AuthInfo,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import {
  assertSecureHttpUrl,
  isLocalhost,
  isRecord,
  parseAbsoluteUrl,
} from "./guards.js";
import { invalidToken } from "./errors.js";
import type {
  BoundOAuthProvider,
  OAuthExtra,
  OAuthProvider,
  OAuthProviderBinding,
  ResourceBoundOAuthProvider,
} from "./provider.js";

export {
  assertSecureHttpUrl,
  isLocalhost,
  parseAbsoluteUrl,
} from "./guards.js";

/** @internal Resolves configured resource identity, or undefined when none is configured. */
export function resolveConfiguredOAuthResource<TUser>(options: {
  provider: OAuthProvider<TUser>;
  basePath: string;
  mcpUrl?: string | URL;
}): URL | undefined {
  const provider = options.provider;
  const basePath = normalizeBasePath(options.basePath);
  if (provider.resource !== undefined) {
    return validateOAuthResource(provider.resource, basePath);
  }
  if (options.mcpUrl !== undefined) {
    return validateOAuthResource(
      appendBasePath(
        requireAbsoluteOrigin(options.mcpUrl, "MCP_URL"),
        basePath
      ),
      basePath
    );
  }
  return undefined;
}

/** @internal Resolves a canonical resource from a trusted local listener. */
export function resolveLocalOAuthResource(
  listenOrigin: string | URL,
  basePath: string
): URL {
  const listenOriginUrl = requireAbsoluteOrigin(listenOrigin, "listen origin");
  if (!isLocalhost(listenOriginUrl)) {
    throw new Error(
      "OAuth listen origin must be localhost or a loopback address"
    );
  }
  return validateOAuthResource(
    appendBasePath(listenOriginUrl, normalizeBasePath(basePath)),
    basePath
  );
}

/** @internal Validates and canonicalizes one resource-server URL. */
export function validateOAuthResource(
  resource: URL | string,
  basePath: string
): URL {
  const normalizedBasePath = normalizeBasePath(basePath);
  const url = parseAbsoluteUrl(resource, "OAuth resource");
  if (url.search !== "" || url.hash !== "") {
    throw new Error(
      "OAuth resource must not include a query string or fragment"
    );
  }
  assertSecureHttpUrl(url, "OAuth resource");
  if (normalizePathname(url.pathname) !== normalizedBasePath) {
    throw new Error(
      `OAuth resource path must exactly match basePath (${normalizedBasePath})`
    );
  }
  url.pathname = normalizedBasePath;
  return url;
}

/** @internal Binds a provider to one canonical resource and creates its verifier. */
export function bindOAuthProvider<TUser>(
  provider: OAuthProvider<TUser>,
  expectedResource: URL
): BoundOAuthProvider<TUser> {
  const canonicalResource = normalizeResourceUrl(expectedResource);
  const resourceBoundProvider = isResourceBoundOAuthProvider(provider);
  if ("bind" in provider && typeof provider.bind !== "function") {
    throw new TypeError("OAuth provider bind must be a function");
  }

  const rawBinding: OAuthProviderBinding<TUser> = resourceBoundProvider
    ? provider.bind(new URL(canonicalResource.href))
    : {
        oauthMetadata: provider.oauthMetadata,
        tokenVerifier: provider.createTokenVerifier(
          new URL(canonicalResource.href)
        ),
        mapAuthInfo: provider.mapAuthInfo,
        ...(provider.requiredScopes !== undefined && {
          requiredScopes: provider.requiredScopes,
        }),
        ...(provider.scopesSupported !== undefined && {
          scopesSupported: provider.scopesSupported,
        }),
        ...(provider.resourceName !== undefined && {
          resourceName: provider.resourceName,
        }),
        ...(provider.serviceDocumentationUrl !== undefined && {
          serviceDocumentationUrl: provider.serviceDocumentationUrl,
        }),
      };

  assertOAuthProviderBinding(rawBinding, resourceBoundProvider);
  const tokenVerifier = rawBinding.tokenVerifier;
  const mapAuthInfo = rawBinding.mapAuthInfo;
  const mapperOwner: object = resourceBoundProvider ? rawBinding : provider;

  return Object.freeze({
    resource: canonicalResource,
    oauthMetadata: snapshotOAuthMetadata(rawBinding.oauthMetadata),
    tokenVerifier,
    mapAuthInfo: (authInfo: AuthInfo) =>
      mapAuthInfo.call(mapperOwner, authInfo),
    ...(rawBinding.requiredScopes !== undefined && {
      requiredScopes: Object.freeze([...rawBinding.requiredScopes]),
    }),
    ...(rawBinding.scopesSupported !== undefined && {
      scopesSupported: Object.freeze([...rawBinding.scopesSupported]),
    }),
    ...(rawBinding.resourceName !== undefined && {
      resourceName: rawBinding.resourceName,
    }),
    ...(rawBinding.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: new URL(rawBinding.serviceDocumentationUrl.href),
    }),
    ...(rawBinding.middleware !== undefined && {
      middleware: rawBinding.middleware,
    }),
  });
}

function isResourceBoundOAuthProvider<TUser>(
  provider: OAuthProvider<TUser>
): provider is ResourceBoundOAuthProvider<TUser> {
  return "bind" in provider && typeof provider.bind === "function";
}

function assertOAuthProviderBinding<TUser>(
  binding: OAuthProviderBinding<TUser>,
  resourceBoundProvider: boolean
): asserts binding is OAuthProviderBinding<TUser> {
  if (binding === null || typeof binding !== "object") {
    throw new TypeError("OAuth provider bind must return an object");
  }
  assertBindingOAuthMetadata(binding.oauthMetadata);
  const tokenVerifier = binding.tokenVerifier;
  if (
    tokenVerifier === null ||
    typeof tokenVerifier !== "object" ||
    typeof tokenVerifier.verifyAccessToken !== "function"
  ) {
    throw new TypeError(
      resourceBoundProvider
        ? "OAuth provider binding tokenVerifier must be an OAuthTokenVerifier"
        : "OAuth provider createTokenVerifier must return an OAuthTokenVerifier"
    );
  }
  if (typeof binding.mapAuthInfo !== "function") {
    throw new TypeError(
      "OAuth provider binding mapAuthInfo must be a function"
    );
  }
  assertBindingStringArray(binding.requiredScopes, "requiredScopes");
  assertBindingStringArray(binding.scopesSupported, "scopesSupported");
  if (
    binding.resourceName !== undefined &&
    (typeof binding.resourceName !== "string" ||
      binding.resourceName.trim().length === 0)
  ) {
    throw new TypeError("resourceName must be a non-empty string");
  }
  if (binding.serviceDocumentationUrl !== undefined) {
    if (!(binding.serviceDocumentationUrl instanceof URL)) {
      throw new TypeError("serviceDocumentationUrl must be a URL");
    }
    assertSecureHttpUrl(
      binding.serviceDocumentationUrl,
      "serviceDocumentationUrl"
    );
  }
  if (
    binding.middleware !== undefined &&
    typeof binding.middleware !== "function"
  ) {
    throw new TypeError("OAuth provider binding middleware must be a function");
  }
}

function assertBindingOAuthMetadata(metadata: unknown): void {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("issuer" in metadata) ||
    typeof metadata.issuer !== "string"
  ) {
    throw new TypeError(
      "OAuth provider binding oauthMetadata must include a string issuer"
    );
  }
  assertSecureHttpUrl(
    parseAbsoluteUrl(
      metadata.issuer,
      "OAuth provider binding oauthMetadata.issuer"
    ),
    "OAuth provider binding oauthMetadata.issuer"
  );
}

function assertBindingStringArray(value: unknown, name: string): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
  ) {
    throw new TypeError(
      `OAuth provider binding ${name} must be an array of strings`
    );
  }
}

function snapshotOAuthMetadata(
  metadata: BoundOAuthProvider<unknown>["oauthMetadata"]
): BoundOAuthProvider<unknown>["oauthMetadata"] {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(metadata as Record<string, unknown>).map(
        ([key, value]) => [
          key,
          Array.isArray(value)
            ? Object.freeze((value as unknown[]).slice())
            : value,
        ]
      )
    )
  ) as BoundOAuthProvider<unknown>["oauthMetadata"];
}

/** @internal Wraps a bound verifier with mcp-use's verified auth mapping. */
export function wrapBoundOAuthTokenVerifier<TUser>(
  boundProvider: BoundOAuthProvider<TUser>
): OAuthTokenVerifier {
  const {
    resource: canonicalResource,
    tokenVerifier,
    mapAuthInfo,
  } = boundProvider;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const authInfo = await tokenVerifier.verifyAccessToken(token);
      assertVerifiedAuthInfo(authInfo);
      assertResourceBinding(authInfo, canonicalResource);

      let mapped: OAuthExtra<TUser>;
      try {
        mapped = mapAuthInfo(authInfo);
      } catch (error) {
        throw invalidToken("Token identity mapping failed", error);
      }
      assertMappedExtra(mapped);

      return {
        ...authInfo,
        scopes: [...authInfo.scopes],
        extra: { ...authInfo.extra, ...mapped },
      };
    },
  };
}

/**
 * @internal Wraps a provider verifier with mcp-use's verified auth mapping.
 * Prefer binding once and calling {@link wrapBoundOAuthTokenVerifier} when a
 * provider is shared by multiple pieces of mount wiring.
 */
export function wrapOAuthTokenVerifier<TUser>(
  provider: OAuthProvider<TUser>,
  expectedResource: URL
): OAuthTokenVerifier {
  return wrapBoundOAuthTokenVerifier(
    bindOAuthProvider(provider, expectedResource)
  );
}

function assertResourceBinding(
  authInfo: AuthInfo,
  expectedResource: URL
): void {
  if (authInfo.resource === undefined) {
    throw invalidToken(
      "Token verifier did not return a validated protected resource"
    );
  }
  const resource = parseTokenResource(authInfo.resource);
  if (resource.href !== normalizeResourceUrl(expectedResource).href) {
    throw invalidToken("Token resource does not match the protected resource");
  }
}

function parseTokenResource(value: unknown): URL {
  if (!(value instanceof URL)) {
    throw invalidToken(
      "Token resource must be an absolute HTTPS URL, or HTTP URL for localhost"
    );
  }
  const resource = value;
  if (
    !/^https?:$/.test(resource.protocol) ||
    resource.username !== "" ||
    resource.password !== "" ||
    resource.search !== "" ||
    resource.hash !== "" ||
    (resource.protocol === "http:" && !isLocalhost(resource))
  ) {
    throw invalidToken(
      "Token resource must be an absolute HTTPS URL, or HTTP URL for localhost"
    );
  }
  return normalizeResourceUrl(resource);
}

function normalizeResourceUrl(resource: URL): URL {
  const normalized = new URL(resource);
  normalized.pathname =
    normalized.pathname === "/" ? "/" : normalized.pathname.replace(/\/+$/, "");
  return normalized;
}

/** @internal Gets immutable provider metadata for Hono adapter wiring. */
export function getOAuthProviderOptions<TUser>(
  provider: Pick<
    BoundOAuthProvider<TUser>,
    | "oauthMetadata"
    | "requiredScopes"
    | "scopesSupported"
    | "resourceName"
    | "serviceDocumentationUrl"
  >
): {
  oauthMetadata: BoundOAuthProvider<TUser>["oauthMetadata"];
  requiredScopes?: string[];
  scopesSupported?: string[];
  resourceName?: string;
  serviceDocumentationUrl?: URL;
} {
  return {
    oauthMetadata: provider.oauthMetadata,
    ...(provider.requiredScopes !== undefined && {
      requiredScopes: [...provider.requiredScopes],
    }),
    ...(provider.scopesSupported !== undefined && {
      scopesSupported: [...provider.scopesSupported],
    }),
    ...(provider.resourceName !== undefined && {
      resourceName: provider.resourceName,
    }),
    ...(provider.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: provider.serviceDocumentationUrl,
    }),
  };
}

function assertVerifiedAuthInfo(
  authInfo: AuthInfo
): asserts authInfo is AuthInfo {
  if (
    authInfo === null ||
    typeof authInfo !== "object" ||
    typeof authInfo.token !== "string" ||
    authInfo.token.length === 0 ||
    typeof authInfo.clientId !== "string" ||
    !Array.isArray(authInfo.scopes) ||
    !authInfo.scopes.every((scope) => typeof scope === "string") ||
    typeof authInfo.expiresAt !== "number" ||
    !Number.isFinite(authInfo.expiresAt) ||
    authInfo.expiresAt <= Date.now() / 1000
  ) {
    throw invalidToken(
      "Token verifier returned invalid authentication information"
    );
  }
}

function assertMappedExtra<TUser>(
  mapped: OAuthExtra<TUser>
): asserts mapped is OAuthExtra<TUser> {
  if (
    mapped === null ||
    typeof mapped !== "object" ||
    !("user" in mapped) ||
    mapped.user === undefined ||
    !isRecord(mapped.payload) ||
    !Array.isArray(mapped.permissions) ||
    !mapped.permissions.every((permission) => typeof permission === "string") ||
    (mapped.providerAccessToken !== undefined &&
      (typeof mapped.providerAccessToken !== "string" ||
        mapped.providerAccessToken.length === 0))
  ) {
    throw invalidToken(
      "Token identity mapping must return user, payload, and string permissions"
    );
  }
}

function requireAbsoluteOrigin(value: string | URL, name: string): URL {
  const url = parseAbsoluteUrl(value, name);
  if (
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(`${name} must be an absolute origin without a path`);
  }
  return url;
}

function appendBasePath(origin: URL, basePath: string): URL {
  const resource = new URL(origin.origin);
  resource.pathname = basePath;
  return resource;
}

function normalizeBasePath(basePath: string): string {
  if (
    !basePath.startsWith("/") ||
    basePath.includes("?") ||
    basePath.includes("#")
  ) {
    throw new Error("basePath must be an absolute URL pathname");
  }
  return normalizePathname(basePath);
}

function normalizePathname(pathname: string): string {
  if (pathname === "/") return "/";
  let end = pathname.length;
  while (end > 0 && pathname.charCodeAt(end - 1) === 47) end--;
  return pathname.slice(0, end);
}
