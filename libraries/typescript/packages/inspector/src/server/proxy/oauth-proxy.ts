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
import type { Context, Hono, Next } from "hono";
import { RateLimiterMemory } from "rate-limiter-flexible";
import {
  INSPECTOR_API_RATE_LIMIT,
  INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
  inspectorRateLimitResponse,
} from "../rate-limit.js";
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
  endpoints: Map<string, OAuthEndpointKind>;
  tokenEndpointAuthMethods: Set<string>;
  updatedAt: number;
};

type ProtectedResourceMetadataTarget = {
  type: "protected-resource";
  /** Resource identifier used to construct this RFC 9728 well-known URL. */
  resourceIdentifier: URL;
};

type ConfidentialClient = {
  clientSecret: string;
  authMethod: "client_secret_basic" | "client_secret_post";
  expiresAt: number;
};

export type OAuthProxyConfidentialClient = {
  clientSecret: string;
  authMethod: "client_secret_basic" | "client_secret_post";
  expiresAt?: number;
};

export type OAuthProxyConfidentialClientResolver = (options: {
  serverUrl: string;
  targetUrl: string;
  clientId: string;
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
  /** Optional authentication applied before any outbound request. */
  authenticate?: (c: Context) => Promise<boolean> | boolean;
  /** Optional deployment policy applied after built-in URL and network checks. */
  validateServerUrl?: (
    serverUrl: string,
    c: Context
  ) => Promise<boolean> | boolean;
  /** Shared process-local limiter for Inspector proxy and OAuth routes. */
  rateLimiter?: RateLimiterMemory;
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
    authenticate,
    validateServerUrl,
    rateLimiter: configuredRateLimiter = new RateLimiterMemory({
      points: INSPECTOR_API_RATE_LIMIT,
      duration: INSPECTOR_RATE_LIMIT_WINDOW_SECONDS,
    }),
    stateStore,
    resolveConfidentialClient,
  } = options;
  const durableStateStore = stateStore ?? createMemoryOAuthProxyStateStore();
  const origins = new Set(allowedOrigins.map(normalizeOrigin));
  const bindings = new Map<string, Binding>();
  const confidentialClients = new Map<string, ConfidentialClient>();
  const rateLimit = async (c: Context, next: Next) => {
    try {
      // RateLimiterMemory prefixes and stringifies keys. The Hono request
      // wrapper therefore maps every request to one mounted-instance budget.
      await configuredRateLimiter.consume(c.req as unknown as string);
    } catch (error) {
      return inspectorRateLimitResponse(c, error);
    }
    return next();
  };

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
  app.use(`${basePath}/*`, rateLimit);

  app.get(`${basePath}/metadata`, async (c) => {
    if (!(await isAuthenticated(c, authenticate))) {
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
      return proxyError(c, error, enableLogging);
    }
    let metadataKind = classifyMetadataTarget(serverUrl, target, binding);
    if (!metadataKind && binding.authorizationServers.size === 0) {
      try {
        await hydrateBinding(
          serverUrl,
          binding,
          allowLoopback,
          timeoutMs,
          maxResponseBodyBytes
        );
        await saveBinding(durableStateStore, bindings, key, binding);
        metadataKind = classifyMetadataTarget(serverUrl, target, binding);
      } catch (error) {
        if (error instanceof OAuthProxyStateStoreError) {
          return proxyError(c, error, enableLogging);
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
      log(enableLogging, `GET ${target}`);
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
      return proxyError(c, error, enableLogging);
    }
  });

  app.post(`${basePath}/proxy`, async (c) => {
    if (!(await isAuthenticated(c, authenticate))) {
      return c.json({ error: "Unauthorized" }, 401);
    }

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

    const serverUrlResult = await validateUrl(request.serverUrl, allowLoopback);
    if ("error" in serverUrlResult) {
      return c.json({ error: serverUrlResult.error }, 400);
    }
    const serverUrl = serverUrlResult.url;
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
      return proxyError(c, error, enableLogging);
    }
    if (binding.endpoints.size === 0) {
      try {
        await hydrateBinding(
          serverUrl,
          binding,
          allowLoopback,
          timeoutMs,
          maxResponseBodyBytes
        );
        await saveBinding(durableStateStore, bindings, bindingKey, binding);
      } catch (error) {
        return proxyError(c, error, enableLogging);
      }
    }
    const endpointKind = binding.endpoints.get(canonicalUrl(target));
    if (!endpointKind) {
      return c.json(
        { error: "OAuth endpoint is not bound to this MCP server" },
        403
      );
    }

    try {
      const headers = filterRequestHeaders(request.headers);
      let body = serializeBody(request.body, headers);
      if (endpointKind === "registration") {
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
          resolveConfidentialClient,
        });
      }
      if (
        new TextEncoder().encode(body ?? "").byteLength > maxRequestBodyBytes
      ) {
        return c.json({ error: "OAuth request body too large" }, 413);
      }

      log(enableLogging, `POST ${endpointKind} ${target}`);
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
      if (contentType.includes("json")) {
        try {
          responseBody = JSON.parse(raw);
        } catch {
          // Preserve malformed upstream bodies; the OAuth client will reject them.
        }
      }
      if (
        endpointKind === "registration" &&
        upstream.ok &&
        responseBody &&
        typeof responseBody === "object" &&
        !Array.isArray(responseBody)
      ) {
        responseBody = await retainConfidentialClient({
          responseBody: responseBody as Record<string, unknown>,
          binding,
          bindingKey,
          clients: confidentialClients,
          stateStore: durableStateStore,
        });
      }
      return c.json({
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
        body: responseBody,
      });
    } catch (error) {
      return proxyError(c, error, enableLogging);
    }
  });

  log(enableLogging, `Mounted at ${basePath}/metadata and ${basePath}/proxy`);
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
    binding.endpoints.set(canonicalUrl(result.url), kind);
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

function confidentialClientKey(bindingKey: string, clientId: string): string {
  return `client:${Buffer.from(`${bindingKey}\u0000${clientId}`, "utf8").toString("base64url")}`;
}

async function retainConfidentialClient(options: {
  responseBody: Record<string, unknown>;
  binding: Binding;
  bindingKey: string;
  clients: Map<string, ConfidentialClient>;
  stateStore: OAuthProxyStateStore;
}): Promise<Record<string, unknown>> {
  const { responseBody, binding, bindingKey, clients, stateStore } = options;
  const clientId = responseBody.client_id;
  const clientSecret = responseBody.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    return responseBody;
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
  const expiresAt =
    upstreamExpiry === 0
      ? Date.now() + CONFIDENTIAL_CLIENT_TTL_MS
      : typeof upstreamExpiry === "number" && upstreamExpiry > 0
        ? upstreamExpiry * 1000
        : Date.now() + CONFIDENTIAL_CLIENT_TTL_MS;

  pruneConfidentialClients(clients);
  const client = {
    clientSecret,
    authMethod,
    expiresAt,
  } satisfies ConfidentialClient;
  const key = confidentialClientKey(bindingKey, clientId);
  clients.set(key, client);
  await storeSet(stateStore, key, client, Math.max(1, expiresAt - Date.now()));
  while (clients.size > MAX_CONFIDENTIAL_CLIENTS) {
    const oldest = clients.keys().next().value as string | undefined;
    if (!oldest) break;
    clients.delete(oldest);
    await storeDelete(stateStore, oldest);
  }

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

  const key = confidentialClientKey(bindingKey, clientId);
  let client = await storeGet<ConfidentialClient>(stateStore, key);
  if (client !== undefined) clients.set(key, client);
  else client = clients.get(key);
  if (client === undefined && resolveConfidentialClient) {
    const resolved = await resolveConfidentialClient({
      serverUrl,
      targetUrl,
      clientId,
    });
    if (resolved) {
      client = {
        clientSecret: resolved.clientSecret,
        authMethod: resolved.authMethod,
        expiresAt:
          resolved.expiresAt ?? Date.now() + CONFIDENTIAL_CLIENT_TTL_MS,
      };
      clients.set(key, client);
      await storeSet(
        stateStore,
        key,
        client,
        Math.max(1, client.expiresAt - Date.now())
      );
    }
  }
  if (!client) return body;
  if (client.expiresAt <= Date.now()) {
    clients.delete(key);
    await storeDelete(stateStore, key);
    return body;
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
    if (client.expiresAt <= now) clients.delete(key);
  }
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
    if (Date.now() - binding.updatedAt <= BINDING_TTL_MS) {
      bindings.set(key, binding);
      return binding;
    }
    await storeDelete(stateStore, bindingStoreKey(key));
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
): Promise<void> {
  bindings.set(key, binding);
  await storeSet(
    stateStore,
    bindingStoreKey(key),
    serializeBinding(binding),
    BINDING_TTL_MS
  );
  pruneBindings(bindings);
}

function emptyBinding(): Binding {
  return {
    authorizationServers: new Set(),
    endpoints: new Map(),
    tokenEndpointAuthMethods: new Set(),
    updatedAt: Date.now(),
  };
}

type SerializedBinding = {
  authorizationServers: string[];
  endpoints: Array<[string, OAuthEndpointKind]>;
  tokenEndpointAuthMethods: string[];
  updatedAt: number;
};

function serializeBinding(binding: Binding): SerializedBinding {
  return {
    authorizationServers: [...binding.authorizationServers],
    endpoints: [...binding.endpoints.entries()],
    tokenEndpointAuthMethods: [...binding.tokenEndpointAuthMethods],
    updatedAt: binding.updatedAt,
  };
}

function deserializeBinding(value: SerializedBinding): Binding {
  return {
    authorizationServers: new Set(value.authorizationServers),
    endpoints: new Map(value.endpoints),
    tokenEndpointAuthMethods: new Set(value.tokenEndpointAuthMethods),
    updatedAt: value.updatedAt,
  };
}

function bindingStoreKey(key: string): string {
  return `binding:${Buffer.from(key, "utf8").toString("base64url")}`;
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
    "Accept, Authorization, Content-Type"
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
  authenticate: OAuthProxyOptions["authenticate"]
): Promise<boolean> {
  return authenticate ? authenticate(c) : true;
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

function log(enabled: boolean, message: string): void {
  if (enabled) console.log(`[OAuth BFF] ${message}`);
}

function proxyError(c: Context, error: unknown, logging: boolean): Response {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (logging) console.error("[OAuth BFF]", message);
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
  } catch (error) {
    throw new OAuthProxyStateStoreError(
      error instanceof Error ? error.message : "OAuth proxy state read failed"
    );
  }
}

async function storeSet<T>(
  store: OAuthProxyStateStore,
  key: string,
  value: T,
  ttlMs: number
): Promise<void> {
  try {
    await store.set(key, value, ttlMs);
  } catch (error) {
    throw new OAuthProxyStateStoreError(
      error instanceof Error ? error.message : "OAuth proxy state write failed"
    );
  }
}

async function storeDelete(
  store: OAuthProxyStateStore,
  key: string
): Promise<void> {
  try {
    await store.delete(key);
  } catch (error) {
    throw new OAuthProxyStateStoreError(
      error instanceof Error ? error.message : "OAuth proxy state delete failed"
    );
  }
}
