/**
 * Public-URL resolution for the server.
 *
 * Two related notions of "where this server lives", generalized from the two
 * pre-P4 helpers (`getServerBaseUrl` and the landing-page `getFullUrl`):
 *
 * - {@link requestOrigin} — the origin *as observed for this request*. Always
 *   inferred from proxy headers (`X-Forwarded-Host`/`X-Forwarded-Proto`) with a
 *   fallback to the `Host` header, then to `http://host:port`. Use it for
 *   things that must match the exact origin the client reached us on (asset
 *   URLs echoed back to a browser, the live transport endpoint on the landing
 *   page).
 *
 * - {@link canonicalOrigin} — the *canonical, stable* public origin of the
 *   server. Precedence: the `MCP_URL` env var → a (spoof-guarded) request
 *   origin → the `http://host:port` fallback. Use it for values that must be
 *   stable and forgery-resistant: OAuth redirect URIs, CSP `resource_domains`,
 *   absolute links baked into metadata.
 *
 * ## Header spoofing
 *
 * `X-Forwarded-Host` is attacker-controllable unless a trusted reverse proxy
 * overwrites it. Trusting it blindly for {@link canonicalOrigin} would let a
 * request forge the OAuth/CSP origin. So when the server is configured with an
 * `allowedOrigins` allow-list (the same list that drives DNS-rebinding host
 * validation), a forwarded host whose hostname is not in that list is NOT
 * trusted for the canonical origin — we fall through to the configured
 * fallback instead. When `allowedOrigins` is unset we preserve the historical
 * behavior and trust the forwarded host (required for zero-config cloud/tunnel
 * deploys where the public host is only known from the proxy header).
 */

import { getEnv } from "./runtime.js";

/**
 * Minimal, framework-agnostic view of the request headers this module reads.
 * A Hono `Context`'s `c.req.header(name)` satisfies this shape, as does any
 * function that looks a header up by (case-insensitive) name.
 */
export interface RequestHeaderReader {
  (name: string): string | undefined;
}

/**
 * Normalize a URL/origin string by replacing a `0.0.0.0` host with `localhost`.
 *
 * `0.0.0.0` is a valid *bind* address (listen on all interfaces) but browsers
 * cannot connect to it as a *destination*, so any URL we hand back to a client
 * must not contain it.
 */
export function normalizeUrlHost(url: string): string {
  return url.replace(/\/\/0\.0\.0\.0(:|\/|$)/, "//localhost$1");
}

/** Extract the lowercased hostname from an origin/URL string, or `null`. */
function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${value}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

/**
 * Build the set of hostnames trusted via `allowedOrigins`. Returns `null` when
 * `allowedOrigins` is unset/empty — the sentinel for "no allow-list configured,
 * trust the forwarded host" (preserves pre-P4 behavior).
 */
function trustedHostnames(allowedOrigins?: string[]): Set<string> | null {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return null;
  }
  const names = allowedOrigins
    .map((origin) => hostnameOf(origin))
    .filter((name): name is string => Boolean(name));
  return new Set(names);
}

/**
 * Infer the origin (`proto://host[:port]`) as observed for a single request.
 *
 * Precedence for each component:
 * - proto: `X-Forwarded-Proto` → `X-Forwarded-Protocol` → the URL's own scheme.
 * - host:  `X-Forwarded-Host` → `Host` → the URL's own host.
 *
 * @param header - Case-insensitive header lookup (e.g. Hono's `c.req.header`).
 * @param requestUrl - The absolute request URL (e.g. Hono's `c.req.url`),
 *   used as the final fallback for scheme/host.
 */
export function requestOrigin(
  header: RequestHeaderReader,
  requestUrl: string
): string {
  let parsed: URL | null = null;
  try {
    parsed = new URL(requestUrl);
  } catch {
    parsed = null;
  }

  const proto =
    header("X-Forwarded-Proto") ||
    header("X-Forwarded-Protocol") ||
    parsed?.protocol.replace(":", "") ||
    "http";

  const host =
    header("X-Forwarded-Host") || header("Host") || parsed?.host || "localhost";

  return normalizeUrlHost(`${proto}://${host}`);
}

/**
 * The forwarded-host component of a request, if present, is it trusted for the
 * canonical origin? A forwarded host is trusted when either no allow-list is
 * configured (`allowedOrigins` unset) or its hostname is present in the list.
 */
function forwardedHostIsTrusted(
  header: RequestHeaderReader,
  trusted: Set<string> | null
): boolean {
  const forwarded = header("X-Forwarded-Host");
  if (!forwarded) {
    // No forwarded host to spoof — the plain Host header path is safe because
    // DNS-rebinding host validation already gates it against `allowedOrigins`.
    return true;
  }
  if (trusted === null) {
    return true; // no allow-list configured → preserve historical trust
  }
  const name = hostnameOf(forwarded);
  return name !== null && trusted.has(name);
}

export interface CanonicalOriginOptions {
  /** Case-insensitive header lookup for the current request, if any. */
  header?: RequestHeaderReader;
  /** The absolute request URL, if a request is in scope. */
  requestUrl?: string;
  /** `host:port` fallback origin (already-formed, e.g. `http://localhost:3000`). */
  fallback: string;
  /** The `allowedOrigins` server config, used to spoof-guard forwarded hosts. */
  allowedOrigins?: string[];
  /**
   * Override for the `MCP_URL` env var. Defaults to reading the environment;
   * pass explicitly in tests to avoid mutating `process.env`.
   */
  mcpUrl?: string;
}

/**
 * Resolve the canonical public origin of the server.
 *
 * Precedence:
 * 1. `MCP_URL` (or {@link CanonicalOriginOptions.mcpUrl}) — an explicit,
 *    operator-provided canonical origin always wins.
 * 2. The request origin — only when its forwarded host is trusted (see the
 *    module docstring on spoofing). Skipped when no request is in scope.
 * 3. The `fallback` (`http://host:port`).
 */
export function canonicalOrigin(options: CanonicalOriginOptions): string {
  const { header, requestUrl, fallback, allowedOrigins } = options;

  const explicit = options.mcpUrl ?? getEnv("MCP_URL");
  if (explicit) {
    return normalizeUrlHost(explicit);
  }

  if (header && requestUrl) {
    const trusted = trustedHostnames(allowedOrigins);
    if (forwardedHostIsTrusted(header, trusted)) {
      return requestOrigin(header, requestUrl);
    }
    // Forwarded host is present but not trusted → ignore it and fall through
    // to the configured fallback rather than forge a canonical origin.
  }

  return normalizeUrlHost(fallback);
}
