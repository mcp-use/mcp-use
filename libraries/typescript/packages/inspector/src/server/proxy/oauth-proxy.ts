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
import { isIP } from "node:net";
import type { Context, Hono } from "hono";

type OAuthEndpointKind =
  | "registration"
  | "token"
  | "revocation"
  | "introspection";

type Binding = {
  authorizationServers: Set<string>;
  endpoints: Map<string, OAuthEndpointKind>;
  updatedAt: number;
};

type ProxyRequest = {
  serverUrl?: unknown;
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
};

export interface OAuthProxyOptions {
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
  /** @default true */
  enableLogging?: boolean;
  /** Optional authentication applied before any outbound request. */
  authenticate?: (c: Context) => Promise<boolean> | boolean;
  /** Optional deployment policy applied after built-in URL and network checks. */
  validateServerUrl?: (
    serverUrl: string,
    c: Context
  ) => Promise<boolean> | boolean;
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
    enableLogging = true,
    authenticate,
    validateServerUrl,
  } = options;
  const origins = new Set(allowedOrigins.map(normalizeOrigin));
  const bindings = new Map<string, Binding>();

  app.use(`${basePath}/*`, async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && !isAllowedOrigin(origin, c.req.url, origins)) {
      return c.json({ error: "Origin not allowed" }, 403);
    }
    if (c.req.method === "OPTIONS") {
      return corsResponse(origin);
    }
    await next();
    if (origin) setCorsHeaders(c.res.headers, origin);
  });

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
    const binding = getBinding(bindings, key);
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
        bindings.set(key, binding);
        metadataKind = classifyMetadataTarget(serverUrl, target, binding);
      } catch {
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
      bindings.set(key, binding);
      pruneBindings(bindings);

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
    const binding = getBinding(bindings, bindingKey);
    if (binding.endpoints.size === 0) {
      try {
        await hydrateBinding(
          serverUrl,
          binding,
          allowLoopback,
          timeoutMs,
          maxResponseBodyBytes
        );
        bindings.set(bindingKey, binding);
        pruneBindings(bindings);
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
      const body = serializeBody(request.body, headers);
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
    new URL(`/.well-known/openid-configuration${path}`, issuer.origin),
    new URL(`${path || ""}/.well-known/openid-configuration`, issuer.origin),
  ];
}

async function bindProtectedResource(
  metadata: Record<string, unknown>,
  serverUrl: URL,
  binding: Binding,
  allowLoopback: boolean
): Promise<void> {
  if (
    typeof metadata.resource !== "string" ||
    canonicalUrl(new URL(metadata.resource)) !== canonicalUrl(serverUrl)
  ) {
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
  for (const metadataUrl of protectedResourceMetadataUrls(serverUrl)) {
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
    await bindProtectedResource(
      parseObject(await readCapped(response, maxResponseBodyBytes)),
      serverUrl,
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
  if (typeof body === "string") return body;
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

function getBinding(bindings: Map<string, Binding>, key: string): Binding {
  const existing = bindings.get(key);
  if (existing && Date.now() - existing.updatedAt <= BINDING_TTL_MS) {
    return existing;
  }
  bindings.delete(key);
  return {
    authorizationServers: new Set(),
    endpoints: new Map(),
    updatedAt: Date.now(),
  };
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

function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`OAuth proxy allowed origin must be an origin: ${origin}`);
  }
  return url.origin;
}

function isAllowedOrigin(
  origin: string,
  requestUrl: string,
  allowed: Set<string>
): boolean {
  try {
    const normalized = normalizeOrigin(origin);
    return normalized === new URL(requestUrl).origin || allowed.has(normalized);
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
