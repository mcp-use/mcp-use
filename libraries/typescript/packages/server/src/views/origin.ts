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
export function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") {
    return undefined;
  }
  const value = process.env[name];
  return value !== undefined && value !== "" ? value : undefined;
}

function parseForwardedHeader(header: string): string | undefined {
  for (const part of header.split(",")) {
    const params = new Map<string, string>();
    for (const token of part.split(";")) {
      const [key, ...rest] = token.trim().split("=");
      if (key === undefined || rest.length === 0) {
        continue;
      }
      params.set(key.toLowerCase(), rest.join("=").replace(/^"|"$/g, ""));
    }
    const proto = params.get("proto");
    const host = params.get("host");
    if (proto !== undefined && host !== undefined) {
      return `${proto}://${host}`;
    }
  }
  return undefined;
}

/**
 * Resolve origin from forwarded headers or the request URL (no env override).
 */
export function resolveRequestOriginFromHeaders(request: Request): string {
  const forwarded = request.headers.get("forwarded");
  if (forwarded !== null) {
    const fromForwarded = parseForwardedHeader(forwarded);
    if (fromForwarded !== undefined) {
      return fromForwarded;
    }
  }

  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  if (proto !== null && host !== null) {
    const firstHost = host.split(",")[0]?.trim();
    const firstProto = proto.split(",")[0]?.trim();
    if (
      firstHost !== undefined &&
      firstProto !== undefined &&
      firstHost !== ""
    ) {
      return `${firstProto}://${firstHost}`;
    }
  }

  return new URL(request.url).origin;
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
export function normalizeAssetsBaseUrl(value: string): string {
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
 * @deprecated Alias for {@link resolveServerOrigin} — kept for OAuth callers.
 */
export function resolveRequestOrigin(request: Request): string {
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
