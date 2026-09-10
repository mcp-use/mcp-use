// ponytail: vendored from mcp-use/src/server/oauth/proxy.ts — keep in sync manually.

/**
 * Server-side OAuth BFF for browser MCP clients.
 *
 * The browser identifies the logical MCP server and the exact OAuth request it
 * wants to make. The BFF independently binds protected-resource metadata to
 * that server, authorization-server metadata to the advertised issuers, and
 * POST requests to endpoints advertised by that metadata.
 */

import { lookup } from "node:dns/promises";
import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import type { Context, Hono } from "hono";
import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  INSPECTOR_API_RATE_LIMIT,
  defaultInspectorGlobalPreAuthRateLimiter,
  defaultInspectorGlobalRateLimiter,
  defaultInspectorPreAuthRateLimiter,
  INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
  inspectorRelayPreAuthKey,
  inspectorServerRateLimitKey,
  inspectorRateLimitResponse,
} from "../rate-limit.js";
import {
  INSPECTOR_RELAY_CAPABILITY_HEADER,
  inspectorRelayTarget,
  type InspectorRelayAuthenticator,
  type InspectorRelayTarget,
} from "../relay-auth.js";
import {
  createMemoryOAuthProxyStateStore,
  type OAuthProxyStateStore,
} from "./oauth-state-store.js";

type OAuthEndpointKind =
  | "registration"
  | "token"
  | "revocation"
  | "introspection";

type Binding = {
  authorizationServers: Set<string>;
  endpoints: Map<string, BoundEndpoint>;
  tokenEndpointAuthMethods: Set<string>;
  revision: number;
  updatedAt: number;
};

type BoundEndpoint = {
  kind: OAuthEndpointKind;
  authorizationServer?: string;
};

type ProtectedResourceMetadataTarget = {
  type: "protected-resource";
  /** Resource identifier used to construct this RFC 9728 well-known URL. */
  resourceIdentifier: URL;
};

type ConfidentialClient = {
  clientSecret: string;
  authMethod: "client_secret_basic" | "client_secret_post";
  expiresAt: number | null;
  revision: number;
  updatedAt: number;
};

export type OAuthProxyConfidentialClient = {
  clientSecret: string;
  authMethod: "client_secret_basic" | "client_secret_post";
  /** `0` means no expiry, matching OAuth DCR semantics. */
  expiresAt?: number;
};

export type OAuthProxyConfidentialClientResolver = (options: {
  serverUrl: string;
  targetUrl: string;
  clientId: string;
  authorizationServer?: string;
}) =>
  | OAuthProxyConfidentialClient
  | undefined
  | Promise<OAuthProxyConfidentialClient | undefined>;

type ProxyRequest = {
  serverUrl?: unknown;
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
};

interface OAuthProxyOptions {
  /** @default "/oauth" */
  basePath?: string;
  /** Cross-origin browser origins allowed to call the BFF. Same-origin calls are always allowed. */
  allowedOrigins?: readonly string[];
  /** Permit HTTP(S) loopback MCP/OAuth targets. Intended only for explicit local development. */
  allowLoopback?: boolean;
  /** @default 10000 */
  timeoutMs?: number;
  /** @default 65536 */
  maxRequestBodyBytes?: number;
  /** @default 1048576 */
  maxResponseBodyBytes?: number;
  /** Exact browser callback path enforced on dynamic registrations. */
  callbackPath?: string;
  /** @default true */
  enableLogging?: boolean;
  /** Optional source label for logs when Inspector shares a dev server process. */
  logPrefix?: string;
  /** Optional authentication applied before any outbound request. */
  authenticate?: InspectorRelayAuthenticator;
  /** Optional deployment policy applied after built-in URL and network checks. */
  validateServerUrl?: (
    serverUrl: string,
    c: Context
  ) => Promise<boolean> | boolean;
  /** Shared process-local limiter for Inspector proxy and OAuth routes. */
  rateLimiter?: RateLimiterMemory;
  /** Higher process-wide backstop against target-key rotation abuse. */
  globalRateLimiter?: RateLimiterMemory;
  /** Per-client limiter protecting the product authentication callback. */
  preAuthRateLimiter?: RateLimiterMemory;
  /** Process-wide limiter protecting the product authentication callback. */
  globalPreAuthRateLimiter?: RateLimiterMemory;
  /** Durable store shared by every Inspector replica. */
  stateStore?: OAuthProxyStateStore;
  /** Server-side resolver for configured confidential clients (never browser-visible). */
  resolveConfidentialClient?: OAuthProxyConfidentialClientResolver;
}

const SAFE_REQUEST_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "dpop",
]);
const SAFE_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "dpop-nonce",
  "expires",
  "pragma",
  "retry-after",
  "www-authenticate",
]);
const ENDPOINT_FIELDS: ReadonlyArray<readonly [string, OAuthEndpointKind]> = [
  ["registration_endpoint", "registration"],
  ["token_endpoint", "token"],
  ["revocation_endpoint", "revocation"],
  ["introspection_endpoint", "introspection"],
];
const BINDING_TTL_MS = 10 * 60 * 1000;
const MAX_BINDINGS = 100;
const CONFIDENTIAL_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONFIDENTIAL_CLIENTS = 500;

export function mountOAuthProxy(
  app: Hono,
  options: OAuthProxyOptions = {}
): void {
  const {
    basePath = "/oauth",
    allowedOrigins = [],
    allowLoopback = false,
    timeoutMs = 10_000,
    maxRequestBodyBytes = 64 * 1024,
    maxResponseBodyBytes = 1024 * 1024,
    callbackPath = "/oauth/callback",
    enableLogging = true,
    logPrefix,
    authenticate,
    validateServerUrl,
    rateLimiter: configuredRateLimiter = new RateLimiterMemory({
      points: INSPECTOR_API_RATE_LIMIT,
      duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
    }),
    globalRateLimiter = defaultInspectorGlobalRateLimiter,
    preAuthRateLimiter = defaultInspectorPreAuthRateLimiter,
    globalPreAuthRateLimiter = defaultInspectorGlobalPreAuthRateLimiter,
    stateStore,
    resolveConfidentialClient,
  } = options;
  const durableStateStore = stateStore ?? createMemoryOAuthProxyStateStore();
  const origins = new Set(allowedOrigins.map(normalizeOrigin));
  const bindings = new Map<string, Binding>();
  const confidentialClients = new Map<string, ConfidentialClient>();
  const bindingLocks = new Map<string, Promise<void>>();

  app.use(`${basePath}/*`, async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !isAllowedOrigin(origin, c, origins)) {
      return c.json({ error: "Origin not allowed" }, 403);
    }
    if (c.req.method === "OPTIONS") {
      return corsResponse(origin);
    }
    await next();
    if (origin) setCorsHeaders(c.res.headers, origin);
  });
  app.use(`${basePath}/*`, async (c, next) => {
    if (c.req.method === "OPTIONS" || !authenticate) return next();
    try {
      await preAuthRateLimiter.consume(
        inspectorRelayPreAuthKey(
          c.req.header("CF-Connecting-IP"),
          c.req.header("X-Forwarded-For")
        )
      );
      await globalPreAuthRateLimiter.consume("inspector-relay:preauth:global");
    } catch (error) {
      return inspectorRateLimitResponse(c, error);
    }
    return next();
  });
  app.get(`${basePath}/metadata`, async (c) => {
    if (
      !(await isAuthenticated(
        c,
        authenticate,
        inspectorRelayTarget(c.req.query("url"), "GET")
      ))
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const serverUrlResult = await validateUrl(
      c.req.query("serverUrl"),
      allowLoopback
    );
    if ("error" in serverUrlResult) {
      return c.json({ error: serverUrlResult.error }, 400);
    }
    const serverUrl = serverUrlResult.url;
    const rateLimitResponse = await consumeRateLimit(
      c,
      configuredRateLimiter,
      globalRateLimiter,
      inspectorServerRateLimitKey("oauth", serverUrl.toString())
    );
    if (rateLimitResponse) return rateLimitResponse;
    if (
      validateServerUrl &&
      !(await validateServerUrl(serverUrl.toString(), c))
    ) {
      return c.json({ error: "MCP server URL not allowed" }, 403);
    }

    const targetResult = await validateUrl(c.req.query("url"), allowLoopback);
    if ("error" in targetResult) {
      return c.json({ error: targetResult.error }, 400);
    }
    const target = targetResult.url;
    const key = canonicalUrl(serverUrl);
    let binding: Binding;
    try {
      binding = await loadBinding(durableStateStore, bindings, key);
    } catch (error) {
      return proxyError(c, error, enableLogging, logPrefix);
    }
    let metadataKind = classifyMetadataTarget(serverUrl, target, binding);
    if (!metadataKind && binding.authorizationServers.size === 0) {
      try {
        binding = await withKeyLock(bindingLocks, key, async () => {
          const latest = await loadBinding(durableStateStore, bindings, key);
          if (latest.authorizationServers.size === 0) {
            await hydrateBinding(
              serverUrl,
              latest,
              allowLoopback,
              timeoutMs,
              maxResponseBodyBytes
            );
            return saveBinding(durableStateStore, bindings, key, latest);
          }
          return latest;
        });
        metadataKind = classifyMetadataTarget(serverUrl, target, binding);
      } catch (error) {
        if (error instanceof OAuthProxyStateStoreError) {
          return proxyError(c, error, enableLogging, logPrefix);
        }
        // The requested target remains unauthorized below.
      }
    }
    if (!metadataKind) {
      return c.json(
        { error: "Metadata target is not bound to this MCP server" },
        403
      );
    }

    try {
      log(enableLogging, logPrefix, `GET ${target}`);
      const upstream = await safeFetch(target, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (isRedirect(upstream.status)) {
        return c.json(
          { error: "OAuth metadata redirects are not allowed" },
          502
        );
      }
      const raw = await readCapped(upstream, maxResponseBodyBytes);
      if (!upstream.ok) {
        return c.body(raw, upstream.status as never, {
          "Content-Type":
            upstream.headers.get("content-type") ?? "application/json",
        });
      }
      const metadata = parseObject(raw);

      if (metadataKind.type === "protected-resource") {
        await bindProtectedResource(
          metadata,
          serverUrl,
          metadataKind.resourceIdentifier,
          binding,
          allowLoopback
        );
      } else {
        await bindAuthorizationServer(
          metadata,
          metadataKind.issuer,
          binding,
          allowLoopback
        );
      }
      binding.updatedAt = Date.now();
      await saveBinding(durableStateStore, bindings, key, binding);

      return c.body(raw, 200, {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
      });
    } catch (error) {
      return proxyError(c, error, enableLogging, logPrefix);
    }
  });

  app.post(`${basePath}/proxy`, async (c) => {
    let request: ProxyRequest;
    try {
      request = JSON.parse(
        await readRequestCapped(c.req.raw, maxRequestBodyBytes)
      ) as ProxyRequest;
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof BodyTooLargeError
              ? "Request body too large"
              : "Invalid JSON request body",
        },
        error instanceof BodyTooLargeError ? 413 : 400
      );
    }

    if (
      !(await isAuthenticated(
        c,
        authenticate,
        inspectorRelayTarget(request.url, "POST")
      ))
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const serverUrlResult = await validateUrl(request.serverUrl, allowLoopback);
    if ("error" in serverUrlResult) {
      return c.json({ error: serverUrlResult.error }, 400);
    }
    const serverUrl = serverUrlResult.url;
    const rateLimitResponse = await consumeRateLimit(
      c,
      configuredRateLimiter,
      globalRateLimiter,
      inspectorServerRateLimitKey("oauth", serverUrl.toString())
    );
    if (rateLimitResponse) return rateLimitResponse;
    if (
      validateServerUrl &&
      !(await validateServerUrl(serverUrl.toString(), c))
    ) {
      return c.json({ error: "MCP server URL not allowed" }, 403);
    }

    const targetResult = await validateUrl(request.url, allowLoopback);
    if ("error" in targetResult) {
      return c.json({ error: targetResult.error }, 400);
    }
    const target = targetResult.url;
    if (request.method !== undefined && request.method !== "POST") {
      return c.json({ error: "Only OAuth endpoint POST is allowed" }, 405);
    }

    const bindingKey = canonicalUrl(serverUrl);
    let binding: Binding;
    try {
      binding = await loadBinding(durableStateStore, bindings, bindingKey);
    } catch (error) {
      return proxyError(c, error, enableLogging, logPrefix);
    }
    if (binding.endpoints.size === 0) {
      try {
        binding = await withKeyLock(bindingLocks, bindingKey, async () => {
          const latest = await loadBinding(
            durableStateStore,
            bindings,
            bindingKey
          );
          if (latest.endpoints.size === 0) {
            await hydrateBinding(
              serverUrl,
              latest,
              allowLoopback,
              timeoutMs,
              maxResponseBodyBytes
            );
            return saveBinding(durableStateStore, bindings, bindingKey, latest);
          }
          return latest;
        });
      } catch (error) {
        return proxyError(c, error, enableLogging, logPrefix);
      }
    }
    const endpoint = binding.endpoints.get(canonicalUrl(target));
    if (!endpoint) {
      return c.json(
        { error: "OAuth endpoint is not bound to this MCP server" },
        403
      );
    }

    try {
      const headers = filterRequestHeaders(request.headers);
      let body = serializeBody(request.body, headers);
      if (endpoint.kind === "registration") {
        const publicOrigin = normalizeOrigin(
          c.req.header("Origin") ?? new URL(c.req.url).origin
        );
        body = enforceRegistrationRedirectUri(
          body,
          headers,
          new URL(callbackPath, publicOrigin).toString()
        );
      } else {
        body = await applyConfidentialClientAuthentication({
          body,
          headers,
          bindingKey,
          clients: confidentialClients,
          stateStore: durableStateStore,
          serverUrl: serverUrl.toString(),
          targetUrl: target.toString(),
          authorizationServer: endpoint.authorizationServer,
          resolveConfidentialClient,
        });
      }
      if (
        new TextEncoder().encode(body ?? "").byteLength > maxRequestBodyBytes
      ) {
        return c.json({ error: "OAuth request body too large" }, 413);
      }

      log(enableLogging, logPrefix, `POST ${endpoint.kind} ${target}`);
      const upstream = await safeFetch(target, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (isRedirect(upstream.status)) {
        return c.json(
          { error: "OAuth endpoint redirects are not allowed" },
          502
        );
      }
      const raw = await readCapped(upstream, maxResponseBodyBytes);
      const responseHeaders = filterResponseHeaders(upstream.headers);
      const contentType = upstream.headers.get("content-type") ?? "";
      let responseBody: unknown = raw;
      if (endpoint.kind === "registration" && !contentType.includes("json")) {
        // DCR responses are JSON. Do not pass an unexpected plaintext response
        // through, since it may contain a provider-issued secret.
        return c.json({ error: "OAuth registration response is invalid" }, 502);
      }
      if (contentType.includes("json")) {
        try {
          responseBody = JSON.parse(raw);
        } catch {
          if (endpoint.kind === "registration") {
            // A malformed successful DCR response may contain a plaintext
            // client_secret. Never echo it to the browser.
            return c.json(
              { error: "OAuth registration response is invalid" },
              502
            );
          }
        }
      }
      if (endpoint.kind === "registration") {
        if (
          !contentType.includes("json") ||
          !responseBody ||
          typeof responseBody !== "object" ||
          Array.isArray(responseBody)
        ) {
          // DCR responses can contain provider-issued credentials even on an
          // error status. Never return a primitive or array body verbatim.
          return c.json(
            { error: "OAuth registration response is invalid" },
            502
          );
        }
        responseBody = upstream.ok
          ? await retainConfidentialClient({
              responseBody: responseBody as Record<string, unknown>,
              binding,
              bindingKey,
              authorizationServer: endpoint.authorizationServer,
              targetUrl: target.toString(),
              clients: confidentialClients,
              stateStore: durableStateStore,
            })
          : sanitizeDcrResponse(responseBody as Record<string, unknown>);
      }
      return c.json({
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (error) {
      return proxyError(c, error, enableLogging, logPrefix);
    }
  });

  log(
    enableLogging,
    logPrefix,
    `Mounted at ${basePath}/metadata and ${basePath}/proxy`
  );
}

async function validateUrl(
  value: unknown,
  allowLoopback: boolean
): Promise<{ url: URL } | { error: string }> {
  if (typeof value !== "string" || !value) {
    return { error: "Missing or invalid URL" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "Invalid URL" };
  }
  if (url.username || url.password || url.hash) {
    return { error: "URL credentials and fragments are not allowed" };
  }

  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol !== "https:") {
    if (!(allowLoopback && loopback && url.protocol === "http:")) {
      return { error: "HTTPS is required" };
    }
  }
  if (loopback) {
    return allowLoopback ? { url } : { error: "Loopback URL not allowed" };
  }
  if (isLocalHostname(url.hostname)) {
    return { error: "Local network URL not allowed" };
  }

  try {
    const addresses = isIP(url.hostname)
      ? [url.hostname]
      : (await lookup(url.hostname, { all: true, verbatim: true })).map(
          ({ address }) => address
        );
    if (
      addresses.length === 0 ||
      addresses.some((address) => !isPublicAddress(address))
    ) {
      return { error: "Private or non-routable URL not allowed" };
    }
  } catch {
    return { error: "URL hostname could not be resolved" };
  }
  return { url };
}

/** Validate a proxy target against the BFF's HTTPS and SSRF policy. */
export async function isSafeProxyTarget(
  value: string,
  allowLoopback = false
): Promise<boolean> {
  return !("error" in (await validateUrl(value, allowLoopback)));
}

function classifyMetadataTarget(
  serverUrl: URL,
  target: URL,
  binding: Binding
):
  | ProtectedResourceMetadataTarget
  | { type: "authorization-server"; issuer: string }
  | undefined {
  const targetUrl = canonicalUrl(target);
  const protectedResourceTarget = protectedResourceMetadataTargets(
    serverUrl
  ).find((candidate) => canonicalUrl(candidate.url) === targetUrl);
  if (protectedResourceTarget) {
    return {
      type: "protected-resource",
      resourceIdentifier: protectedResourceTarget.resourceIdentifier,
    };
  }
  for (const issuer of binding.authorizationServers) {
    if (
      authorizationServerMetadataUrls(new URL(issuer)).some(
        (candidate) => canonicalUrl(candidate) === targetUrl
      )
    ) {
      return { type: "authorization-server", issuer };
    }
  }
  return undefined;
}

function protectedResourceMetadataTargets(serverUrl: URL): Array<{
  url: URL;
  resourceIdentifier: URL;
}> {
  const path = serverUrl.pathname === "/" ? "" : serverUrl.pathname;
  return [
    {
      url: new URL(
        `/.well-known/oauth-protected-resource${path}`,
        serverUrl.origin
      ),
      resourceIdentifier: serverUrl,
    },
    {
      url: new URL("/.well-known/oauth-protected-resource", serverUrl.origin),
      resourceIdentifier: new URL(serverUrl.origin),
    },
  ];
}

function authorizationServerMetadataUrls(issuer: URL): URL[] {
  const path = issuer.pathname === "/" ? "" : issuer.pathname;
  return [
    new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin),
    new URL(`/.well-known/openid-configuration${path}`, issuer.origin),
    new URL(`${path || ""}/.well-known/openid-configuration`, issuer.origin),
  ];
}

async function bindProtectedResource(
  metadata: Record<string, unknown>,
  serverUrl: URL,
  resourceIdentifier: URL,
  binding: Binding,
  allowLoopback: boolean
): Promise<void> {
  const advertisedResource = parseResourceUrl(metadata.resource, allowLoopback);
  const matchesDiscoveredResource =
    advertisedResource !== undefined &&
    canonicalUrl(advertisedResource) === canonicalUrl(resourceIdentifier);
  const matchesCompatibleParentResource =
    advertisedResource !== undefined &&
    isCompatibleParentResource(serverUrl, advertisedResource);

  if (!matchesDiscoveredResource && !matchesCompatibleParentResource) {
    throw new InvalidUpstreamError(
      "Protected-resource metadata does not match serverUrl"
    );
  }
  if (
    !Array.isArray(metadata.authorization_servers) ||
    metadata.authorization_servers.length === 0
  ) {
    throw new InvalidUpstreamError(
      "Protected-resource metadata has no authorization servers"
    );
  }

  const issuers = new Set<string>();
  for (const value of metadata.authorization_servers) {
    const result = await validateUrl(value, allowLoopback);
    if ("error" in result) {
      throw new InvalidUpstreamError(
        `Unsafe authorization server: ${result.error}`
      );
    }
    issuers.add(canonicalUrl(result.url));
  }
  binding.authorizationServers = issuers;
  binding.endpoints.clear();
  binding.tokenEndpointAuthMethods.clear();
}

/**
 * Parse an advertised RFC 9728 resource without allowing URI shapes that are
 * unsafe or invalid as OAuth resource indicators.
 */
function parseResourceUrl(
  value: unknown,
  allowLoopback: boolean
): URL | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    const allowedProtocol =
      url.protocol === "https:" ||
      (allowLoopback &&
        url.protocol === "http:" &&
        isLoopbackHostname(url.hostname));
    if (!allowedProtocol || url.username || url.password || url.hash) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

/**
 * Compatibility policy used by the official MCP TypeScript SDK: an MCP
 * endpoint may advertise a broader resource on the same origin when the
 * advertised path is a segment-aware parent of the endpoint path.
 *
 * This intentionally rejects cross-origin resources and sibling paths. The
 * advertised value is not rewritten; the OAuth client sends it verbatim in
 * authorization, token, and refresh requests.
 */
function isCompatibleParentResource(
  serverUrl: URL,
  advertisedResource: URL
): boolean {
  if (serverUrl.origin !== advertisedResource.origin) return false;
  if (serverUrl.pathname.length < advertisedResource.pathname.length) {
    return false;
  }

  const serverPath = serverUrl.pathname.endsWith("/")
    ? serverUrl.pathname
    : `${serverUrl.pathname}/`;
  const resourcePath = advertisedResource.pathname.endsWith("/")
    ? advertisedResource.pathname
    : `${advertisedResource.pathname}/`;
  return serverPath.startsWith(resourcePath);
}

async function bindAuthorizationServer(
  metadata: Record<string, unknown>,
  expectedIssuer: string,
  binding: Binding,
  allowLoopback: boolean
): Promise<void> {
  if (
    typeof metadata.issuer !== "string" ||
    canonicalUrl(new URL(metadata.issuer)) !== expectedIssuer
  ) {
    throw new InvalidUpstreamError(
      "Authorization-server metadata issuer mismatch"
    );
  }
  binding.endpoints.clear();
  binding.tokenEndpointAuthMethods = new Set(
    Array.isArray(metadata.token_endpoint_auth_methods_supported)
      ? metadata.token_endpoint_auth_methods_supported.filter(
          (method): method is string => typeof method === "string"
        )
      : []
  );
  for (const [field, kind] of ENDPOINT_FIELDS) {
    const value = metadata[field];
    if (value === undefined) continue;
    const result = await validateUrl(value, allowLoopback);
    if ("error" in result) {
      throw new InvalidUpstreamError(`Unsafe ${field}: ${result.error}`);
    }
    binding.endpoints.set(canonicalUrl(result.url), {
      kind,
      authorizationServer: expectedIssuer,
    });
  }
}

async function hydrateBinding(
  serverUrl: URL,
  binding: Binding,
  allowLoopback: boolean,
  timeoutMs: number,
  maxResponseBodyBytes: number
): Promise<void> {
  for (const target of protectedResourceMetadataTargets(serverUrl)) {
    const response = await safeFetch(target.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (isRedirect(response.status)) {
      throw new InvalidUpstreamError(
        "OAuth metadata redirects are not allowed"
      );
    }
    if (!response.ok) continue;
    await bindProtectedResource(
      parseObject(await readCapped(response, maxResponseBodyBytes)),
      serverUrl,
      target.resourceIdentifier,
      binding,
      allowLoopback
    );
    break;
  }
  if (binding.authorizationServers.size === 0) {
    throw new InvalidUpstreamError(
      "Protected-resource metadata could not be discovered"
    );
  }

  for (const issuer of binding.authorizationServers) {
    let bound = false;
    for (const metadataUrl of authorizationServerMetadataUrls(
      new URL(issuer)
    )) {
      const response = await safeFetch(metadataUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (isRedirect(response.status)) {
        throw new InvalidUpstreamError(
          "OAuth metadata redirects are not allowed"
        );
      }
      if (!response.ok) continue;
      await bindAuthorizationServer(
        parseObject(await readCapped(response, maxResponseBodyBytes)),
        issuer,
        binding,
        allowLoopback
      );
      bound = true;
      break;
    }
    if (bound) break;
  }
  if (binding.endpoints.size === 0) {
    throw new InvalidUpstreamError(
      "Authorization-server metadata could not be discovered"
    );
  }
  binding.updatedAt = Date.now();
}

async function safeFetch(url: URL, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

function filterRequestHeaders(value: unknown): Headers {
  const result = new Headers();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const [name, rawValue] of Object.entries(value)) {
    const lower = name.toLowerCase();
    if (lower === INSPECTOR_RELAY_CAPABILITY_HEADER.toLowerCase()) continue;
    if (SAFE_REQUEST_HEADERS.has(lower) && typeof rawValue === "string") {
      result.set(lower, rawValue);
    }
  }
  return result;
}

function filterResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) result[name] = value;
  });
  return result;
}

function serializeBody(body: unknown, headers: Headers): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    if (!headers.has("content-type")) {
      try {
        JSON.parse(body);
        headers.set("content-type", "application/json");
      } catch {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }
    }
    return body;
  }
  const contentType = headers.get("content-type") ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(
      body as Record<string, unknown>
    )) {
      params.append(key, String(value));
    }
    return params.toString();
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return JSON.stringify(body);
}

function sanitizeDcrResponse(
  responseBody: Record<string, unknown>
): Record<string, unknown> {
  const browserSafe = { ...responseBody };
  delete browserSafe.client_secret;
  delete browserSafe.client_secret_expires_at;
  return browserSafe;
}

function confidentialClientKey(
  bindingKey: string,
  authorizationServer: string | undefined,
  clientId: string
): string {
  return `client:${Buffer.from(
    `${bindingKey}\u0000${authorizationServer ?? "unknown"}\u0000${clientId}`,
    "utf8"
  ).toString("base64url")}`;
}

async function retainConfidentialClient(options: {
  responseBody: Record<string, unknown>;
  binding: Binding;
  bindingKey: string;
  authorizationServer?: string;
  targetUrl: string;
  clients: Map<string, ConfidentialClient>;
  stateStore: OAuthProxyStateStore;
}): Promise<Record<string, unknown>> {
  const {
    responseBody,
    binding,
    bindingKey,
    authorizationServer,
    targetUrl,
    clients,
    stateStore,
  } = options;
  const clientId = responseBody.client_id;
  const clientSecret = responseBody.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    // A successful DCR response must never echo a secret that we could not
    // bind to a valid client ID. This also handles partially malformed JSON.
    const browserSafe = { ...responseBody };
    delete browserSafe.client_secret;
    delete browserSafe.client_secret_expires_at;
    return browserSafe;
  }

  const returnedMethod = responseBody.token_endpoint_auth_method;
  const authMethod =
    returnedMethod === "client_secret_post" ||
    returnedMethod === "client_secret_basic"
      ? returnedMethod
      : binding.tokenEndpointAuthMethods.has("client_secret_basic")
        ? "client_secret_basic"
        : "client_secret_post";
  const upstreamExpiry = responseBody.client_secret_expires_at;
  const expiresAt: number | null =
    upstreamExpiry === 0
      ? null
      : typeof upstreamExpiry === "number" && upstreamExpiry > 0
        ? upstreamExpiry * 1000
        : Date.now() + CONFIDENTIAL_CLIENT_TTL_MS;

  pruneConfidentialClients(clients);
  const key = confidentialClientKey(
    bindingKey,
    authorizationServer ?? targetUrl,
    clientId
  );
  const previous = clients.get(key);
  const client = {
    clientSecret,
    authMethod,
    expiresAt,
    revision: Math.max((previous?.revision ?? 0) + 1, Date.now()),
    updatedAt: Date.now(),
  } satisfies ConfidentialClient;
  const persisted = await storeSetIfNewer(
    stateStore,
    key,
    client,
    clientTtl(client)
  );
  if (!persisted) {
    const latest = await storeGet<unknown>(stateStore, key);
    const latestClient = normalizeConfidentialClient(latest);
    if (latestClient && compareVersions(client, latestClient) < 0) {
      cacheConfidentialClient(clients, key, latestClient);
    }
  }
  cacheConfidentialClient(clients, key, client);

  const browserSafe = { ...responseBody };
  delete browserSafe.client_secret;
  delete browserSafe.client_secret_expires_at;
  browserSafe.token_endpoint_auth_method = "none";
  return browserSafe;
}

async function applyConfidentialClientAuthentication(options: {
  body: string | undefined;
  headers: Headers;
  bindingKey: string;
  authorizationServer?: string;
  clients: Map<string, ConfidentialClient>;
  stateStore: OAuthProxyStateStore;
  serverUrl: string;
  targetUrl: string;
  resolveConfidentialClient?: OAuthProxyConfidentialClientResolver;
}): Promise<string | undefined> {
  const {
    body,
    headers,
    bindingKey,
    clients,
    stateStore,
    serverUrl,
    targetUrl,
    authorizationServer,
    resolveConfidentialClient,
  } = options;
  if (
    !body ||
    !(headers.get("content-type") ?? "").includes(
      "application/x-www-form-urlencoded"
    )
  ) {
    return body;
  }

  const params = new URLSearchParams(body);
  const clientId = params.get("client_id");
  if (!clientId) return body;

  const key = confidentialClientKey(
    bindingKey,
    authorizationServer ?? targetUrl,
    clientId
  );
  let localClient = clients.get(key);
  if (localClient && isExpired(localClient.expiresAt)) {
    clients.delete(key);
    localClient = undefined;
  }
  const persistedClient = normalizeConfidentialClient(
    await storeGet<unknown>(stateStore, key)
  );
  let client: ConfidentialClient | undefined = localClient;
  if (
    persistedClient &&
    (!client || compareVersions(client, persistedClient) < 0)
  ) {
    client = persistedClient;
    cacheConfidentialClient(clients, key, persistedClient);
  }
  if (client === undefined && resolveConfidentialClient) {
    const resolved = await resolveConfidentialClient({
      serverUrl,
      targetUrl,
      clientId,
      authorizationServer,
    });
    if (resolved) {
      client = {
        clientSecret: resolved.clientSecret,
        authMethod: resolved.authMethod,
        expiresAt:
          resolved.expiresAt === 0
            ? null
            : (resolved.expiresAt ?? Date.now() + CONFIDENTIAL_CLIENT_TTL_MS),
        revision: Date.now(),
        updatedAt: Date.now(),
      };
      const persisted = await storeSetIfNewer(
        stateStore,
        key,
        client,
        clientTtl(client)
      );
      if (!persisted) {
        const latest = normalizeConfidentialClient(
          await storeGet<unknown>(stateStore, key)
        );
        if (latest && compareVersions(client, latest) < 0) client = latest;
      }
      cacheConfidentialClient(clients, key, client);
    }
  }
  if (!client) return body;
  if (isExpired(client.expiresAt)) {
    clients.delete(key);
    const deleted = await storeDeleteIfVersion(stateStore, key, client);
    if (!deleted) {
      const latest = normalizeConfidentialClient(
        await storeGet<unknown>(stateStore, key)
      );
      if (latest && !isExpired(latest.expiresAt)) {
        cacheConfidentialClient(clients, key, latest);
        client = latest;
      } else {
        return body;
      }
    } else {
      return body;
    }
  }

  params.delete("client_secret");
  if (client.authMethod === "client_secret_basic") {
    const encoded = Buffer.from(
      `${encodeOAuthClientCredential(clientId)}:${encodeOAuthClientCredential(client.clientSecret)}`,
      "utf8"
    ).toString("base64");
    headers.set("authorization", `Basic ${encoded}`);
  } else {
    headers.delete("authorization");
    params.set("client_id", clientId);
    params.set("client_secret", client.clientSecret);
  }
  return params.toString();
}

function encodeOAuthClientCredential(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

function pruneConfidentialClients(
  clients: Map<string, ConfidentialClient>
): void {
  const now = Date.now();
  for (const [key, client] of clients) {
    if (isExpired(client.expiresAt, now)) clients.delete(key);
  }
}

function isExpired(expiresAt: number | null, now = Date.now()): boolean {
  return expiresAt !== null && expiresAt <= now;
}

function clientTtl(client: ConfidentialClient): number | undefined {
  return client.expiresAt === null
    ? undefined
    : Math.max(1, client.expiresAt - Date.now());
}

function cacheConfidentialClient(
  clients: Map<string, ConfidentialClient>,
  key: string,
  client: ConfidentialClient
): void {
  const local = clients.get(key);
  if (!local || compareVersions(local, client) < 0) clients.set(key, client);
  pruneConfidentialClients(clients);
  while (clients.size > MAX_CONFIDENTIAL_CLIENTS) {
    const oldest = clients.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    clients.delete(oldest);
  }
}

function normalizeConfidentialClient(
  value: unknown
): ConfidentialClient | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.clientSecret !== "string" ||
    (record.authMethod !== "client_secret_basic" &&
      record.authMethod !== "client_secret_post")
  ) {
    return undefined;
  }
  const expiresAt = record.expiresAt;
  if (
    expiresAt !== null &&
    (typeof expiresAt !== "number" || !Number.isFinite(expiresAt))
  ) {
    return undefined;
  }
  const revision =
    typeof record.revision === "number" && Number.isFinite(record.revision)
      ? record.revision
      : 0;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0;
  return {
    clientSecret: record.clientSecret,
    authMethod: record.authMethod,
    expiresAt: expiresAt as number | null,
    revision,
    updatedAt,
  };
}

async function readRequestCapped(
  request: Request,
  maxBytes: number
): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError();
  }
  return readStreamCapped(request.body, maxBytes);
}

async function readCapped(
  response: Response,
  maxBytes: number
): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new BodyTooLargeError();
  }
  return readStreamCapped(response.body, maxBytes);
}

async function readStreamCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseObject(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidUpstreamError("OAuth metadata is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidUpstreamError("OAuth metadata is not an object");
  }
  return parsed as Record<string, unknown>;
}

async function loadBinding(
  stateStore: OAuthProxyStateStore,
  bindings: Map<string, Binding>,
  key: string
): Promise<Binding> {
  const persisted = await storeGet<SerializedBinding>(
    stateStore,
    bindingStoreKey(key)
  );
  if (persisted !== undefined) {
    const binding = deserializeBinding(persisted);
    const local = bindings.get(key);
    if (Date.now() - binding.updatedAt <= BINDING_TTL_MS) {
      if (!local || compareVersions(local, binding) < 0) {
        bindings.set(key, binding);
        pruneBindings(bindings);
        return binding;
      }
      return local;
    }
    if (!local || Date.now() - local.updatedAt > BINDING_TTL_MS) {
      const deleted = await storeDeleteIfVersion(
        stateStore,
        bindingStoreKey(key),
        binding
      );
      if (!deleted) {
        // Another replica may have refreshed the binding after the stale read
        // but before the compare-and-delete. Adopt that value instead of
        // allowing an unconditional cleanup to erase the fresh state.
        const latest = await storeGet<SerializedBinding>(
          stateStore,
          bindingStoreKey(key)
        );
        if (latest !== undefined) {
          const latestBinding = deserializeBinding(latest);
          if (Date.now() - latestBinding.updatedAt <= BINDING_TTL_MS) {
            bindings.set(key, latestBinding);
            pruneBindings(bindings);
            return latestBinding;
          }
        }
      }
    } else {
      return local;
    }
  }
  const existing = bindings.get(key);
  if (existing && Date.now() - existing.updatedAt <= BINDING_TTL_MS) {
    return existing;
  }
  bindings.delete(key);
  return emptyBinding();
}

async function saveBinding(
  stateStore: OAuthProxyStateStore,
  bindings: Map<string, Binding>,
  key: string,
  binding: Binding
): Promise<Binding> {
  const now = Date.now();
  const next: Binding = {
    ...binding,
    revision: Math.max(binding.revision + 1, now),
    updatedAt: now,
  };
  const persisted = await storeSetIfNewer(
    stateStore,
    bindingStoreKey(key),
    serializeBinding(next),
    BINDING_TTL_MS
  );
  if (persisted === false) {
    const latest = await storeGet<SerializedBinding>(
      stateStore,
      bindingStoreKey(key)
    );
    if (latest !== undefined) {
      const latestBinding = deserializeBinding(latest);
      const authoritative =
        compareVersions(next, latestBinding) <= 0 ? latestBinding : next;
      bindings.set(key, authoritative);
      pruneBindings(bindings);
      return authoritative;
    } else {
      bindings.set(key, next);
      pruneBindings(bindings);
      return next;
    }
  } else {
    bindings.set(key, next);
    pruneBindings(bindings);
    return next;
  }
}

function emptyBinding(): Binding {
  return {
    authorizationServers: new Set(),
    endpoints: new Map(),
    tokenEndpointAuthMethods: new Set(),
    revision: 0,
    updatedAt: Date.now(),
  };
}

type SerializedBinding = {
  authorizationServers: string[];
  endpoints: Array<[string, OAuthEndpointKind | BoundEndpoint]>;
  tokenEndpointAuthMethods: string[];
  revision?: number;
  updatedAt: number;
};

function serializeBinding(binding: Binding): SerializedBinding {
  return {
    authorizationServers: [...binding.authorizationServers],
    endpoints: [...binding.endpoints.entries()],
    tokenEndpointAuthMethods: [...binding.tokenEndpointAuthMethods],
    revision: binding.revision,
    updatedAt: binding.updatedAt,
  };
}

function deserializeBinding(value: SerializedBinding): Binding {
  if (
    !Array.isArray(value.authorizationServers) ||
    !Array.isArray(value.endpoints) ||
    !Array.isArray(value.tokenEndpointAuthMethods) ||
    !value.authorizationServers.every(
      (entry): entry is string => typeof entry === "string"
    ) ||
    !value.tokenEndpointAuthMethods.every(
      (entry): entry is string => typeof entry === "string"
    ) ||
    !Number.isFinite(value.updatedAt) ||
    (value.revision !== undefined &&
      (!Number.isFinite(value.revision) || value.revision < 0))
  ) {
    throw new InvalidUpstreamError("OAuth proxy state is invalid");
  }
  const endpoints = new Map<string, BoundEndpoint>();
  for (const entry of value.endpoints) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") {
      throw new InvalidUpstreamError("OAuth proxy state is invalid");
    }
    const endpoint = entry[1];
    if (typeof endpoint === "string" && isOAuthEndpointKind(endpoint)) {
      endpoints.set(entry[0], { kind: endpoint });
    } else if (
      endpoint &&
      typeof endpoint === "object" &&
      typeof endpoint.kind === "string" &&
      isOAuthEndpointKind(endpoint.kind)
    ) {
      endpoints.set(entry[0], {
        kind: endpoint.kind,
        authorizationServer:
          typeof endpoint.authorizationServer === "string"
            ? endpoint.authorizationServer
            : undefined,
      });
    } else {
      throw new InvalidUpstreamError("OAuth proxy state is invalid");
    }
  }
  return {
    authorizationServers: new Set(value.authorizationServers),
    endpoints,
    tokenEndpointAuthMethods: new Set(value.tokenEndpointAuthMethods),
    revision: value.revision ?? value.updatedAt,
    updatedAt: value.updatedAt,
  };
}

function bindingStoreKey(key: string): string {
  return `binding:${Buffer.from(key, "utf8").toString("base64url")}`;
}

function isOAuthEndpointKind(value: string): value is OAuthEndpointKind {
  return (
    value === "registration" ||
    value === "token" ||
    value === "revocation" ||
    value === "introspection"
  );
}

function pruneBindings(bindings: Map<string, Binding>): void {
  const now = Date.now();
  for (const [key, binding] of bindings) {
    if (now - binding.updatedAt > BINDING_TTL_MS) bindings.delete(key);
  }
  while (bindings.size > MAX_BINDINGS) {
    const oldest = bindings.keys().next().value as string | undefined;
    if (!oldest) break;
    bindings.delete(oldest);
  }
}

function compareVersions(
  a: { revision: number; updatedAt: number },
  b: { revision: number; updatedAt: number }
): number {
  if (a.revision !== b.revision) return a.revision - b.revision;
  return a.updatedAt - b.updatedAt;
}

function canonicalUrl(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  if (
    (copy.protocol === "https:" && copy.port === "443") ||
    (copy.protocol === "http:" && copy.port === "80")
  ) {
    copy.port = "";
  }
  return copy.toString().replace(/\/$/, "");
}

function enforceRegistrationRedirectUri(
  body: string | undefined,
  headers: Headers,
  callbackUrl: string
): string | undefined {
  if (!body) return body;
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return body;
    }
    return JSON.stringify({
      ...(parsed as Record<string, unknown>),
      redirect_uris: [callbackUrl],
    });
  } catch {
    return body;
  }
}

function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`OAuth proxy allowed origin must be an origin: ${origin}`);
  }
  return url.origin;
}

function isAllowedOrigin(
  origin: string,
  c: Context,
  allowed: Set<string>
): boolean {
  try {
    const normalized = normalizeOrigin(origin);
    if (normalized === new URL(c.req.url).origin || allowed.has(normalized)) {
      return true;
    }

    const originUrl = new URL(normalized);
    const forwardedHost = c.req
      .header("x-forwarded-host")
      ?.split(",")[0]
      ?.trim();
    const requestHost = forwardedHost || c.req.header("host");
    if (!requestHost || originUrl.host !== requestHost) return false;

    const forwardedProto = c.req
      .header("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    return !forwardedProto || `${forwardedProto}:` === originUrl.protocol;
  } catch {
    return false;
  }
}

function corsResponse(origin: string | undefined): Response {
  const headers = new Headers();
  if (origin) setCorsHeaders(headers, origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    `Accept, Authorization, Content-Type, DPoP, ${INSPECTOR_RELAY_CAPABILITY_HEADER}`
  );
  headers.set("Access-Control-Max-Age", "600");
  return new Response(null, { status: 204, headers });
}

function setCorsHeaders(headers: Headers, origin: string): void {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
}

async function isAuthenticated(
  c: Context,
  authenticate: OAuthProxyOptions["authenticate"],
  target: InspectorRelayTarget | undefined
): Promise<boolean> {
  return authenticate ? authenticate(c, target) : true;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home.arpa")
  );
}

function isPublicAddress(address: string): boolean {
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) {
      return isPublicAddress(lower.slice(7));
    }
    return !(
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower) ||
      lower.startsWith("ff") ||
      lower.startsWith("2001:db8:")
    );
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b, c] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function log(
  enabled: boolean,
  prefix: string | undefined,
  message: string
): void {
  if (enabled) {
    console.log(
      prefix === undefined
        ? `[OAuth BFF] ${message}`
        : `${prefix} [OAuth BFF] ${message}`
    );
  }
}

function proxyError(
  c: Context,
  error: unknown,
  logging: boolean,
  prefix: string | undefined
): Response {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (logging) {
    console.error(
      prefix === undefined ? "[OAuth BFF]" : `${prefix} [OAuth BFF]`,
      message
    );
  }
  if (error instanceof OAuthProxyStateStoreError) {
    return c.json({ error: "OAuth proxy state store unavailable" }, 503);
  }
  if (error instanceof BodyTooLargeError) {
    return c.json({ error: "Upstream response too large" }, 502);
  }
  if (error instanceof InvalidUpstreamError) {
    return c.json({ error: error.message }, 502);
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return c.json({ error: "OAuth upstream timed out" }, 504);
  }
  return c.json({ error: "OAuth upstream request failed" }, 502);
}

class BodyTooLargeError extends Error {}
class InvalidUpstreamError extends Error {}
class OAuthProxyStateStoreError extends Error {}

async function storeGet<T>(
  store: OAuthProxyStateStore,
  key: string
): Promise<T | undefined> {
  try {
    return await store.get<T>(key);
  } catch {
    // Store errors can contain Redis URLs, hostnames, or other sensitive
    // provider details. Keep the public/logged error deliberately generic.
    throw new OAuthProxyStateStoreError("OAuth proxy state read failed");
  }
}

async function storeSetIfNewer<T>(
  store: OAuthProxyStateStore,
  key: string,
  value: T,
  ttlMs?: number
): Promise<boolean> {
  try {
    if (store.setIfNewer) return await store.setIfNewer(key, value, ttlMs);
    const current = await store.get<unknown>(key);
    if (current !== undefined && compareUnknownVersions(current, value) >= 0) {
      return false;
    }
    await store.set(key, value, ttlMs);
    return true;
  } catch {
    throw new OAuthProxyStateStoreError("OAuth proxy state write failed");
  }
}

async function storeDeleteIfVersion(
  store: OAuthProxyStateStore,
  key: string,
  expected: { revision: number; updatedAt: number }
): Promise<boolean> {
  try {
    // Stores without the optional atomic primitive must not perform an
    // unsafe get-then-delete. Expiry remains enforced by the store TTL.
    return store.deleteIfVersion
      ? await store.deleteIfVersion(key, expected)
      : false;
  } catch {
    throw new OAuthProxyStateStoreError("OAuth proxy state delete failed");
  }
}

function compareUnknownVersions(a: unknown, b: unknown): number {
  const version = (value: unknown) => {
    if (!value || typeof value !== "object")
      return { revision: 0, updatedAt: 0 };
    const record = value as Record<string, unknown>;
    return {
      revision:
        typeof record.revision === "number" && Number.isFinite(record.revision)
          ? record.revision
          : 0,
      updatedAt:
        typeof record.updatedAt === "number" &&
        Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : 0,
    };
  };
  return compareVersions(version(a), version(b));
}

async function consumeRateLimit(
  c: Context,
  limiter: RateLimiterMemory,
  globalLimiter: RateLimiterMemory,
  key: string
): Promise<Response | undefined> {
  try {
    await globalLimiter.consume("inspector-api:global");
    await limiter.consume(key);
    return undefined;
  } catch (error) {
    return inspectorRateLimitResponse(c, error);
  }
}

async function withKeyLock<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = locks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, current);
  if (previous) await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}
