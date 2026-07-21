import { isIP } from "node:net";
import { Buffer } from "node:buffer";

import { pathUnderBase, type FetchHandler } from "./fetch-app.js";
import { resolveServerOrigin } from "./views/origin.js";

type OAuthEndpointKind =
  | "registration"
  | "token"
  | "revocation"
  | "introspection";

type OAuthBinding = {
  authorizationServers: Set<string>;
  endpoints: Map<string, OAuthEndpointKind>;
  tokenEndpointAuthMethods: Set<string>;
  updatedAt: number;
};

type ConfidentialClient = {
  clientSecret: string;
  authMethod: "client_secret_basic" | "client_secret_post";
  expiresAt: number;
};

type OAuthProxyRequest = {
  serverUrl?: unknown;
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
};

/** Injectable network primitives used by the Inspector proxy runtime. */
export interface InspectorProxyRuntime {
  fetch?: typeof fetch;
  resolveHostname?: (hostname: string) => Promise<string[]>;
}

/** Configuration for the fetch-native Inspector proxy routes. */
export interface InspectorProxyHandlerOptions {
  basePath: string;
  allowLoopback?: boolean;
  timeoutMs?: number;
  maxOAuthRequestBodyBytes?: number;
  maxOAuthResponseBodyBytes?: number;
  runtime?: InspectorProxyRuntime;
}

const SAFE_OAUTH_REQUEST_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "dpop",
]);
const SAFE_OAUTH_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "dpop-nonce",
  "expires",
  "pragma",
  "retry-after",
  "www-authenticate",
]);
const SAFE_MCP_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-disposition",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "location",
  "mcp-protocol-version",
  "mcp-session-id",
  "retry-after",
  "www-authenticate",
]);
const OAUTH_ENDPOINT_FIELDS: ReadonlyArray<
  readonly [string, OAuthEndpointKind]
> = [
  ["registration_endpoint", "registration"],
  ["token_endpoint", "token"],
  ["revocation_endpoint", "revocation"],
  ["introspection_endpoint", "introspection"],
];
const BINDING_TTL_MS = 10 * 60 * 1000;
const MAX_BINDINGS = 100;
const CONFIDENTIAL_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONFIDENTIAL_CLIENTS = 500;
const MAX_REDIRECTS = 3;

/** True for the fetch-native Inspector proxy and OAuth BFF routes. */
export function matchesInspectorProxyPath(
  request: Request,
  basePath: string
): boolean {
  const pathname = new URL(request.url).pathname;
  const api = pathUnderBase(basePath, "inspector/api");
  return pathname === `${api}/proxy` || pathname.startsWith(`${api}/oauth/`);
}

/**
 * Create the Inspector's fetch-native MCP relay and OAuth BFF.
 *
 * The handler is intentionally independent of Hono so the v2 server can keep
 * its fetch-native runtime while restoring the routes consumed by the CDN
 * Inspector bundle.
 */
export function createInspectorProxyHandler(
  options: InspectorProxyHandlerOptions
): FetchHandler {
  const {
    basePath,
    allowLoopback = false,
    timeoutMs = 10_000,
    maxOAuthRequestBodyBytes = 64 * 1024,
    maxOAuthResponseBodyBytes = 1024 * 1024,
    runtime = {},
  } = options;
  const fetchFn = runtime.fetch ?? globalThis.fetch.bind(globalThis);
  const resolveHostname =
    runtime.resolveHostname ??
    (async (hostname: string) => {
      const { lookup } = await import("node:dns/promises");
      return (await lookup(hostname, { all: true, verbatim: true })).map(
        ({ address }) => address
      );
    });
  const proxyPath = pathUnderBase(basePath, "inspector/api/proxy");
  const oauthBase = pathUnderBase(basePath, "inspector/api/oauth");
  const bindings = new Map<string, OAuthBinding>();
  const confidentialClients = new Map<string, ConfidentialClient>();

  const validateTarget = async (
    value: unknown
  ): Promise<{ url: URL } | { error: string }> => {
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
        : await resolveHostname(url.hostname);
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
  };

  const oauthMetadata = async (
    request: Request,
    requestUrl: URL
  ): Promise<Response> => {
    const serverResult = await validateTarget(
      requestUrl.searchParams.get("serverUrl")
    );
    if ("error" in serverResult) {
      return json({ error: serverResult.error }, 400, request);
    }
    const targetResult = await validateTarget(
      requestUrl.searchParams.get("url")
    );
    if ("error" in targetResult) {
      return json({ error: targetResult.error }, 400, request);
    }

    const serverUrl = serverResult.url;
    const target = targetResult.url;
    const bindingKey = canonicalUrl(serverUrl);
    const binding = getBinding(bindings, bindingKey);
    let metadataKind = classifyMetadataTarget(serverUrl, target, binding);
    if (!metadataKind && binding.authorizationServers.size === 0) {
      try {
        await hydrateBinding({
          serverUrl,
          binding,
          validateTarget,
          fetchFn,
          timeoutMs,
          maxResponseBodyBytes: maxOAuthResponseBodyBytes,
        });
        bindings.set(bindingKey, binding);
        metadataKind = classifyMetadataTarget(serverUrl, target, binding);
      } catch {
        // The requested target is rejected below.
      }
    }
    if (!metadataKind) {
      return json(
        { error: "Metadata target is not bound to this MCP server" },
        403,
        request
      );
    }

    try {
      const upstream = await fetchFn(target, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        signal: requestSignal(request, timeoutMs),
      });
      if (isRedirect(upstream.status)) {
        return json(
          { error: "OAuth metadata redirects are not allowed" },
          502,
          request
        );
      }
      const raw = await readCapped(upstream, maxOAuthResponseBodyBytes);
      if (!upstream.ok) {
        return withCors(
          new Response(raw, {
            status: upstream.status,
            headers: {
              "content-type":
                upstream.headers.get("content-type") ?? "application/json",
            },
          }),
          request
        );
      }
      const metadata = parseObject(raw);
      if (metadataKind.type === "protected-resource") {
        await bindProtectedResource(
          metadata,
          serverUrl,
          binding,
          validateTarget
        );
      } else {
        await bindAuthorizationServer(
          metadata,
          metadataKind.issuer,
          binding,
          validateTarget
        );
      }
      binding.updatedAt = Date.now();
      bindings.set(bindingKey, binding);
      pruneBindings(bindings);
      return withCors(
        new Response(raw, {
          status: 200,
          headers: {
            "content-type":
              upstream.headers.get("content-type") ?? "application/json",
          },
        }),
        request
      );
    } catch (error) {
      return oauthError(error, request);
    }
  };

  const oauthEndpoint = async (request: Request): Promise<Response> => {
    let payload: OAuthProxyRequest;
    try {
      payload = JSON.parse(
        await readRequestCapped(request, maxOAuthRequestBodyBytes)
      ) as OAuthProxyRequest;
    } catch (error) {
      return json(
        {
          error:
            error instanceof BodyTooLargeError
              ? "Request body too large"
              : "Invalid JSON request body",
        },
        error instanceof BodyTooLargeError ? 413 : 400,
        request
      );
    }

    const serverResult = await validateTarget(payload.serverUrl);
    if ("error" in serverResult) {
      return json({ error: serverResult.error }, 400, request);
    }
    const targetResult = await validateTarget(payload.url);
    if ("error" in targetResult) {
      return json({ error: targetResult.error }, 400, request);
    }
    if (payload.method !== undefined && payload.method !== "POST") {
      return json(
        { error: "Only OAuth endpoint POST is allowed" },
        405,
        request
      );
    }

    const bindingKey = canonicalUrl(serverResult.url);
    const binding = getBinding(bindings, bindingKey);
    if (binding.endpoints.size === 0) {
      try {
        await hydrateBinding({
          serverUrl: serverResult.url,
          binding,
          validateTarget,
          fetchFn,
          timeoutMs,
          maxResponseBodyBytes: maxOAuthResponseBodyBytes,
        });
        bindings.set(bindingKey, binding);
        pruneBindings(bindings);
      } catch (error) {
        return oauthError(error, request);
      }
    }
    const endpointKind = binding.endpoints.get(canonicalUrl(targetResult.url));
    if (!endpointKind) {
      return json(
        { error: "OAuth endpoint is not bound to this MCP server" },
        403,
        request
      );
    }

    try {
      const headers = filterOAuthRequestHeaders(payload.headers);
      let body = serializeOAuthBody(payload.body, headers);
      if (endpointKind === "registration") {
        const callbackUrl = new URL(
          pathUnderBase(basePath, "inspector/oauth/callback"),
          resolveServerOrigin(request)
        ).toString();
        body = enforceRegistrationRedirectUri(body, headers, callbackUrl);
      } else {
        body = applyConfidentialClientAuthentication({
          body,
          headers,
          bindingKey,
          clients: confidentialClients,
        });
      }
      if (
        new TextEncoder().encode(body ?? "").byteLength >
        maxOAuthRequestBodyBytes
      ) {
        return json({ error: "OAuth request body too large" }, 413, request);
      }
      const upstream = await fetchFn(targetResult.url, {
        method: "POST",
        headers,
        ...(body !== undefined && { body }),
        redirect: "manual",
        signal: requestSignal(request, timeoutMs),
      });
      if (isRedirect(upstream.status)) {
        return json(
          { error: "OAuth endpoint redirects are not allowed" },
          502,
          request
        );
      }
      const raw = await readCapped(upstream, maxOAuthResponseBodyBytes);
      const contentType = upstream.headers.get("content-type") ?? "";
      let responseBody: unknown = raw;
      if (contentType.includes("json")) {
        try {
          responseBody = JSON.parse(raw);
        } catch {
          // Preserve malformed upstream bodies; the SDK validates them.
        }
      }
      if (
        endpointKind === "registration" &&
        upstream.ok &&
        responseBody &&
        typeof responseBody === "object" &&
        !Array.isArray(responseBody)
      ) {
        responseBody = retainConfidentialClient({
          responseBody: responseBody as Record<string, unknown>,
          binding,
          bindingKey,
          clients: confidentialClients,
        });
      }
      return json(
        {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: filterOAuthResponseHeaders(upstream.headers),
          body: responseBody,
        },
        200,
        request
      );
    } catch (error) {
      return oauthError(error, request);
    }
  };

  return async (request) => {
    const requestUrl = new URL(request.url);
    if (!isSameOriginRequest(request, requestUrl)) {
      return json({ error: "Origin not allowed" }, 403, request);
    }
    if (request.method === "OPTIONS") {
      return preflight(request);
    }
    if (requestUrl.pathname === proxyPath) {
      return proxyMcp(request, {
        validateTarget,
        fetchFn,
        timeoutMs,
      });
    }
    if (
      requestUrl.pathname === `${oauthBase}/metadata` &&
      request.method === "GET"
    ) {
      return oauthMetadata(request, requestUrl);
    }
    if (
      requestUrl.pathname === `${oauthBase}/proxy` &&
      request.method === "POST"
    ) {
      return oauthEndpoint(request);
    }
    return withCors(new Response("Not Found", { status: 404 }), request);
  };
}

async function proxyMcp(
  request: Request,
  options: {
    validateTarget: (
      value: unknown
    ) => Promise<{ url: URL } | { error: string }>;
    fetchFn: typeof fetch;
    timeoutMs: number;
  }
): Promise<Response> {
  const targetResult = await options.validateTarget(
    request.headers.get("x-target-url")
  );
  if ("error" in targetResult) {
    return json({ error: targetResult.error }, 403, request);
  }

  const headers = proxyRequestHeaders(request.headers);
  const bodyBytes =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : new Uint8Array(await request.arrayBuffer()).slice();
  let target = targetResult.url;
  let method = request.method;
  let body = bodyBytes;

  try {
    for (let redirects = 0; ; redirects += 1) {
      const upstream = await options.fetchFn(target, {
        method,
        headers,
        ...(body !== undefined && { body }),
        redirect: "manual",
        signal: requestSignal(request, options.timeoutMs),
      });
      const location = upstream.headers.get("location");
      if (!isRedirect(upstream.status) || !location) {
        return proxyMcpResponse(upstream, request);
      }
      if (redirects >= MAX_REDIRECTS) {
        return json({ error: "Too many upstream redirects" }, 502, request);
      }
      const redirectResult = await options.validateTarget(
        new URL(location, target).toString()
      );
      if ("error" in redirectResult) {
        return json({ error: "Redirect target is not allowed" }, 403, request);
      }
      if (redirectResult.url.origin !== target.origin) {
        headers.delete("authorization");
        headers.delete("proxy-authorization");
      }
      target = redirectResult.url;
      if (
        upstream.status === 303 ||
        ((upstream.status === 301 || upstream.status === 302) &&
          method === "POST")
      ) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
        headers.delete("content-length");
      }
    }
  } catch (error) {
    const timeout =
      error instanceof DOMException && error.name === "TimeoutError";
    return json(
      {
        error: timeout ? "Upstream request timed out" : "Proxy request failed",
      },
      timeout ? 504 : 502,
      request
    );
  }
}

async function proxyMcpResponse(
  upstream: Response,
  request: Request
): Promise<Response> {
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (SAFE_MCP_RESPONSE_HEADERS.has(name.toLowerCase())) {
      headers.set(name, value);
    }
  });
  const contentType = upstream.headers.get("content-type") ?? "";
  const contentLength = upstream.headers.get("content-length");
  if (contentType.includes("text/event-stream") && !contentLength) {
    return withCors(
      new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      }),
      request
    );
  }
  const body = await upstream.arrayBuffer();
  headers.set("content-length", String(body.byteLength));
  return withCors(
    new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    }),
    request
  );
}

function proxyRequestHeaders(source: Headers): Headers {
  const result = new Headers();
  source.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      lower === "host" ||
      lower === "origin" ||
      lower === "referer" ||
      lower === "cookie" ||
      lower === "proxy-authorization" ||
      lower === "accept-encoding" ||
      lower === "content-length" ||
      lower === "connection" ||
      lower === "cdn-loop" ||
      lower === "x-original-host" ||
      lower.startsWith("sec-fetch-") ||
      lower.startsWith("x-forwarded-") ||
      lower.startsWith("x-target-") ||
      lower.startsWith("x-proxy-") ||
      lower.startsWith("cf-")
    ) {
      return;
    }
    result.set(name, value);
  });
  result.set("accept-encoding", "identity");
  return result;
}

function classifyMetadataTarget(
  serverUrl: URL,
  target: URL,
  binding: OAuthBinding
):
  | { type: "protected-resource" }
  | { type: "authorization-server"; issuer: string }
  | undefined {
  const targetUrl = canonicalUrl(target);
  if (
    protectedResourceMetadataUrls(serverUrl).some(
      (candidate) => canonicalUrl(candidate) === targetUrl
    )
  ) {
    return { type: "protected-resource" };
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

function protectedResourceMetadataUrls(serverUrl: URL): URL[] {
  const path = serverUrl.pathname === "/" ? "" : serverUrl.pathname;
  return [
    new URL(`/.well-known/oauth-protected-resource${path}`, serverUrl.origin),
    new URL("/.well-known/oauth-protected-resource", serverUrl.origin),
  ];
}

function authorizationServerMetadataUrls(issuer: URL): URL[] {
  const path = issuer.pathname === "/" ? "" : issuer.pathname;
  return [
    new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin),
    new URL("/.well-known/oauth-authorization-server", issuer.origin),
    new URL(`/.well-known/openid-configuration${path}`, issuer.origin),
    new URL(`${path}/.well-known/openid-configuration`, issuer.origin),
  ];
}

async function bindProtectedResource(
  metadata: Record<string, unknown>,
  serverUrl: URL,
  binding: OAuthBinding,
  validateTarget: (value: unknown) => Promise<{ url: URL } | { error: string }>
): Promise<void> {
  let resource: URL;
  try {
    resource = new URL(String(metadata.resource));
  } catch {
    throw new InvalidUpstreamError(
      "Protected-resource metadata has an invalid resource"
    );
  }
  if (canonicalUrl(resource) !== canonicalUrl(serverUrl)) {
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
    const result = await validateTarget(value);
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

async function bindAuthorizationServer(
  metadata: Record<string, unknown>,
  expectedIssuer: string,
  binding: OAuthBinding,
  validateTarget: (value: unknown) => Promise<{ url: URL } | { error: string }>
): Promise<void> {
  let issuer: URL;
  try {
    issuer = new URL(String(metadata.issuer));
  } catch {
    throw new InvalidUpstreamError(
      "Authorization-server metadata has an invalid issuer"
    );
  }
  if (canonicalUrl(issuer) !== expectedIssuer) {
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
  for (const [field, kind] of OAUTH_ENDPOINT_FIELDS) {
    const value = metadata[field];
    if (value === undefined) continue;
    const result = await validateTarget(value);
    if ("error" in result) {
      throw new InvalidUpstreamError(`Unsafe ${field}: ${result.error}`);
    }
    binding.endpoints.set(canonicalUrl(result.url), kind);
  }
}

async function hydrateBinding(options: {
  serverUrl: URL;
  binding: OAuthBinding;
  validateTarget: (value: unknown) => Promise<{ url: URL } | { error: string }>;
  fetchFn: typeof fetch;
  timeoutMs: number;
  maxResponseBodyBytes: number;
}): Promise<void> {
  const {
    serverUrl,
    binding,
    validateTarget,
    fetchFn,
    timeoutMs,
    maxResponseBodyBytes,
  } = options;
  for (const metadataUrl of protectedResourceMetadataUrls(serverUrl)) {
    const response = await fetchFn(metadataUrl, {
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
      binding,
      validateTarget
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
      const response = await fetchFn(metadataUrl, {
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
        validateTarget
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

function filterOAuthRequestHeaders(value: unknown): Headers {
  const result = new Headers();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const [name, rawValue] of Object.entries(value)) {
    if (
      SAFE_OAUTH_REQUEST_HEADERS.has(name.toLowerCase()) &&
      typeof rawValue === "string"
    ) {
      result.set(name, rawValue);
    }
  }
  return result;
}

function filterOAuthResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (SAFE_OAUTH_RESPONSE_HEADERS.has(name.toLowerCase())) {
      result[name] = value;
    }
  });
  return result;
}

function serializeOAuthBody(
  body: unknown,
  headers: Headers
): string | undefined {
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
  return `${bindingKey}\u0000${clientId}`;
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

function retainConfidentialClient(options: {
  responseBody: Record<string, unknown>;
  binding: OAuthBinding;
  bindingKey: string;
  clients: Map<string, ConfidentialClient>;
}): Record<string, unknown> {
  const { responseBody, binding, bindingKey, clients } = options;
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
      ? Number.POSITIVE_INFINITY
      : typeof upstreamExpiry === "number" && upstreamExpiry > 0
        ? upstreamExpiry * 1000
        : Date.now() + CONFIDENTIAL_CLIENT_TTL_MS;

  pruneConfidentialClients(clients);
  clients.set(confidentialClientKey(bindingKey, clientId), {
    clientSecret,
    authMethod,
    expiresAt,
  });
  while (clients.size > MAX_CONFIDENTIAL_CLIENTS) {
    const oldest = clients.keys().next().value as string | undefined;
    if (!oldest) break;
    clients.delete(oldest);
  }

  const browserSafe = { ...responseBody };
  delete browserSafe.client_secret;
  delete browserSafe.client_secret_expires_at;
  // The browser sends only the public client_id. The BFF restores the actual
  // confidential authentication method when forwarding bound token requests.
  browserSafe.token_endpoint_auth_method = "none";
  return browserSafe;
}

function applyConfidentialClientAuthentication(options: {
  body: string | undefined;
  headers: Headers;
  bindingKey: string;
  clients: Map<string, ConfidentialClient>;
}): string | undefined {
  const { body, headers, bindingKey, clients } = options;
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
  const client = clients.get(key);
  if (!client) return body;
  if (client.expiresAt <= Date.now()) {
    clients.delete(key);
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

function getBinding(
  bindings: Map<string, OAuthBinding>,
  key: string
): OAuthBinding {
  const existing = bindings.get(key);
  if (existing && Date.now() - existing.updatedAt <= BINDING_TTL_MS) {
    return existing;
  }
  bindings.delete(key);
  return {
    authorizationServers: new Set(),
    endpoints: new Map(),
    tokenEndpointAuthMethods: new Set(),
    updatedAt: Date.now(),
  };
}

function pruneBindings(bindings: Map<string, OAuthBinding>): void {
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

function isSameOriginRequest(request: Request, _requestUrl: URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return (
      new URL(origin).origin === new URL(resolveServerOrigin(request)).origin
    );
  } catch {
    return false;
  }
}

function preflight(request: Request): Response {
  const response = new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers":
        "Accept, Authorization, Content-Type, X-Target-URL, X-Server-Id, MCP-Protocol-Version, MCP-Session-Id",
      "access-control-max-age": "600",
    },
  });
  return withCors(response, request);
}

function withCors(response: Response, request: Request): Response {
  const origin = request.headers.get("origin");
  if (origin) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.append("vary", "Origin");
  }
  response.headers.set(
    "access-control-expose-headers",
    "Content-Type, Location, MCP-Session-Id, WWW-Authenticate, *"
  );
  return response;
}

function json(value: unknown, status: number, request: Request): Response {
  return withCors(
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    }),
    request
  );
}

function requestSignal(request: Request, timeoutMs: number): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
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

function oauthError(error: unknown, request: Request): Response {
  if (error instanceof BodyTooLargeError) {
    return json({ error: "Upstream response too large" }, 502, request);
  }
  if (error instanceof InvalidUpstreamError) {
    return json({ error: error.message }, 502, request);
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return json({ error: "OAuth upstream timed out" }, 504, request);
  }
  return json({ error: "OAuth upstream request failed" }, 502, request);
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
    if (lower.startsWith("::ffff:")) return isPublicAddress(lower.slice(7));
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
  const a = parts[0]!;
  const b = parts[1]!;
  const c = parts[2]!;
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

class BodyTooLargeError extends Error {}
class InvalidUpstreamError extends Error {}
