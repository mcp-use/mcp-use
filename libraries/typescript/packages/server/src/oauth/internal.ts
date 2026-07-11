import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import type { OAuthExtra, OAuthProvider } from "./provider.js";
import { resolveOAuthProvider as resolveProvider } from "./provider.js";

/** @internal Resolves an opaque provider for server-side wiring. */
export const resolveOAuthProvider = resolveProvider;

/** @internal Inputs used to resolve a canonical resource-server URL. */
export interface OAuthResourceResolutionOptions<TUser> {
  provider: OAuthProvider<TUser>;
  basePath: string;
  mode: "handler" | "listen";
  mcpUrl?: string | URL;
  listenOrigin?: string | URL;
}

/** @internal Resolves configured resource identity, or undefined when none is configured. */
export function resolveConfiguredOAuthResource<TUser>(options: {
  provider: OAuthProvider<TUser>;
  basePath: string;
  mcpUrl?: string | URL;
}): URL | undefined {
  const provider = resolveProvider(options.provider);
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

/** @internal Rejects resources that cannot safely identify an OAuth resource server. */
export function resolveOAuthResource<TUser>(
  options: OAuthResourceResolutionOptions<TUser>
): URL {
  const basePath = normalizeBasePath(options.basePath);
  const mcpUrl =
    options.mcpUrl ??
    (typeof process === "undefined" ? undefined : process.env["MCP_URL"]);
  const configuredResource = resolveConfiguredOAuthResource({
    provider: options.provider,
    basePath,
    ...(mcpUrl !== undefined && { mcpUrl }),
  });
  if (configuredResource !== undefined) {
    return configuredResource;
  }

  if (options.mode === "listen" && options.listenOrigin !== undefined) {
    return resolveLocalOAuthResource(options.listenOrigin, basePath);
  }

  throw new Error(
    "OAuth requires an explicit resource or MCP_URL when using getHandler()"
  );
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

/** @internal Wraps a provider verifier with mcp-use's verified auth mapping. */
export function wrapOAuthTokenVerifier<TUser>(
  provider: OAuthProvider<TUser>,
  expectedResource?: URL
): OAuthTokenVerifier {
  const internal = resolveProvider(provider);
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const authInfo = await internal.tokenVerifier.verifyAccessToken(token);
      assertVerifiedAuthInfo(authInfo);
      assertResourceBinding(authInfo, expectedResource);

      let mapped: OAuthExtra<TUser>;
      try {
        mapped = internal.toMcpUseExtra(authInfo);
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

function assertResourceBinding(
  authInfo: AuthInfo,
  expectedResource: URL | undefined
): void {
  if (authInfo.resource === undefined) {
    if (expectedResource !== undefined) {
      throw invalidToken(
        "Token must include a resource claim matching the protected resource"
      );
    }
    return;
  }
  const resource = parseTokenResource(authInfo.resource);
  if (expectedResource !== undefined) {
    if (resource.href !== normalizeResourceUrl(expectedResource).href) {
      throw invalidToken("Token resource does not match the protected resource");
    }
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
  oauthMetadata: ReturnType<
    typeof resolveOAuthProvider<TUser>
  >["oauthMetadata"];
  requiredScopes?: string[];
  scopesSupported?: string[];
  resourceName?: string;
  serviceDocumentationUrl?: URL;
} {
  const internal = resolveProvider(provider);
  return {
    oauthMetadata: internal.oauthMetadata,
    ...(internal.requiredScopes !== undefined && {
      requiredScopes: [...internal.requiredScopes],
    }),
    ...(internal.scopesSupported !== undefined && {
      scopesSupported: [...internal.scopesSupported],
    }),
    ...(internal.resourceName !== undefined && {
      resourceName: internal.resourceName,
    }),
    ...(internal.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: internal.serviceDocumentationUrl,
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

function invalidToken(message: string, cause?: unknown): OAuthError {
  const error = new OAuthError(OAuthErrorCode.InvalidToken, message);
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
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

function parseAbsoluteUrl(value: string | URL, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.origin === "null" || url.username !== "" || url.password !== "") {
    throw new Error(`${name} must be an absolute URL without credentials`);
  }
  return url;
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
  return pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
}

function isLocalhost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function assertSecureHttpUrl(url: URL, name: string): void {
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && isLocalhost(url)) {
    return;
  }
  throw new Error(`${name} must use HTTPS, or HTTP for localhost`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
