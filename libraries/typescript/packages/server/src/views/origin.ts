/**
 * Resolve public origins and asset URL prefixes for view documents and CSP.
 *
 * **Server origin** (`resolveServerOrigin`): MCP endpoint / API base — OAuth
 * resource identity, `connectDomains`, dev HMR websocket host.
 *
 * **Assets base** (`resolveAssetsBase`): prefix for view JS/CSS and
 * `public/` URLs — may include a path (CDN bucket prefix).
 */

/** Strip trailing slashes from a URL prefix. */
function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : undefined;
}

function parseForwardedHeader(
  header: string,
  fallbackHost: string
): string | undefined {
  for (const part of header.split(",")) {
    const params = new Map<string, string>();
    for (const token of part.split(";")) {
      const [key, ...rest] = token.trim().split("=");
      if (key === undefined || rest.length === 0) {
        continue;
      }
      params.set(key.toLowerCase(), rest.join("=").replace(/^"|"$/g, ""));
    }
    const proto = params.get("proto")?.toLowerCase();
    if (proto === "http" || proto === "https") {
      return `${proto}://${params.get("host") || fallbackHost}`;
    }
  }
  return undefined;
}

/**
 * Resolve origin from forwarded headers or the request URL (no env override).
 *
 * A forwarded `http` or `https` protocol is honored on its own, and any other
 * value is ignored. The host comes from the forwarded host when present, then
 * `X-Forwarded-Host`, then the request.
 */
export function resolveRequestOriginFromHeaders(request: Request): string {
  const requestUrl = new URL(request.url);
  const fallbackHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    requestUrl.host;

  const forwarded = request.headers.get("forwarded");
  if (forwarded !== null) {
    const fromForwarded = parseForwardedHeader(forwarded, fallbackHost);
    if (fromForwarded !== undefined) {
      return fromForwarded;
    }
  }

  const proto = request.headers.get("x-forwarded-proto");
  if (proto !== null) {
    const firstProto = proto.split(",")[0]?.trim().toLowerCase();
    if (firstProto === "http" || firstProto === "https") {
      return `${firstProto}://${fallbackHost}`;
    }
  }

  return requestUrl.origin;
}

/**
 * Server public origin — `MCP_URL` when valid, else forwarded/request origin.
 *
 * Uses `.origin` only (path suffix on `MCP_URL` is ignored).
 */
export function resolveServerOrigin(request: Request): string {
  const mcpUrl = readEnv("MCP_URL");
  if (mcpUrl !== undefined) {
    try {
      return new URL(mcpUrl).origin;
    } catch {
      // Fall through when MCP_URL is malformed.
    }
  }
  return resolveRequestOriginFromHeaders(request);
}

/**
 * Resolve the public MCP endpoint used for Claude's sandbox identity.
 * An origin-only `MCP_URL` uses `basePath`; a URL with a path is already an
 * endpoint and is kept verbatim. Otherwise use the request path and query
 * with the forwarded/request origin. Asset URLs never identify the endpoint.
 *
 * @internal
 */
export function resolveMcpEndpoint(
  request: Request | undefined,
  basePath: string
): string | undefined {
  const mcpUrl = readEnv("MCP_URL");
  if (mcpUrl !== undefined) {
    try {
      const url = new URL(mcpUrl);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.pathname !== "/" || url.search !== ""
          ? mcpUrl
          : `${stripTrailingSlashes(mcpUrl)}${basePath}`;
      }
    } catch {
      // Match server-origin resolution's fallback for malformed MCP_URL.
    }
  }
  if (request === undefined) return undefined;
  const url = new URL(request.url);
  return `${resolveRequestOriginFromHeaders(request)}${url.pathname}${url.search}`;
}

/**
 * Normalize an authored HTTP(S) view URL to an origin, without changing
 * legacy host-specific domain strings. This is not host submission validation.
 *
 * @internal
 */
export function normalizeViewDomain(domain: string): string {
  try {
    const url = new URL(domain);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.origin;
    }
  } catch {
    // Preserve legacy host-specific strings, including computed Claude domains.
  }
  return domain;
}

/**
 * Extract the origin from an assets URL prefix (origin + optional path).
 */
export function originFromAssetsBase(assetsBase: string): string {
  try {
    return new URL(assetsBase).origin;
  } catch {
    return assetsBase;
  }
}

/**
 * Normalize `MCP_ASSETS_URL` to a URL prefix without trailing slash.
 */
function normalizeAssetsBaseUrl(value: string): string {
  return stripTrailingSlashes(value);
}

/**
 * Assets URL prefix for view JS/CSS and `public/` — `MCP_ASSETS_URL` when set,
 * else server origin from {@link resolveServerOrigin}.
 */
export function resolveAssetsBase(request: Request): string {
  const assetsUrl = readEnv("MCP_ASSETS_URL");
  if (assetsUrl !== undefined) {
    try {
      return normalizeAssetsBaseUrl(new URL(assetsUrl).href.replace(/\/$/, ""));
    } catch {
      // Fall through when MCP_ASSETS_URL is malformed.
    }
  }
  return resolveServerOrigin(request);
}

/**
 * Whether `MCP_ASSETS_URL` is explicitly configured (distinct from server).
 */
export function hasExplicitAssetsBase(): boolean {
  const assetsUrl = readEnv("MCP_ASSETS_URL");
  if (assetsUrl === undefined) {
    return false;
  }
  try {
    new URL(assetsUrl);
    return true;
  } catch {
    return false;
  }
}
