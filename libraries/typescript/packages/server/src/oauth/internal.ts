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
  const tokenVerifier = provider.createTokenVerifier(
    new URL(canonicalResource.href)
  );
  if (
    tokenVerifier === null ||
    typeof tokenVerifier !== "object" ||
    typeof tokenVerifier.verifyAccessToken !== "function"
  ) {
    throw new TypeError(
      "OAuth provider createTokenVerifier must return an OAuthTokenVerifier"
    );
  }

  return {
    provider,
    resource: canonicalResource,
    tokenVerifier,
  };
}

/** @internal Wraps a bound verifier with mcp-use's verified auth mapping. */
export function wrapBoundOAuthTokenVerifier<TUser>(
  boundProvider: BoundOAuthProvider<TUser>
): OAuthTokenVerifier {
  const {
    provider,
    resource: canonicalResource,
    tokenVerifier,
  } = boundProvider;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const authInfo = await tokenVerifier.verifyAccessToken(token);
      assertVerifiedAuthInfo(authInfo);
      assertResourceBinding(authInfo, canonicalResource);

      let mapped: OAuthExtra<TUser>;
      try {
        mapped = provider.mapAuthInfo(authInfo);
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
  provider: OAuthProvider<TUser>
): {
  oauthMetadata: OAuthProvider<TUser>["oauthMetadata"];
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
    !mapped.permissions.every((permission) => typeof permission === "string")
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
