/**
 * OriginResolver
 *
 * Single source of truth for "which origins is this MCP server reachable from?".
 * Drives both:
 *   - Host validation middleware (DNS-rebinding protection)
 *   - Widget <base> / window.__getFile / window.__mcpPublicUrl rewriting at read time
 *   - Widget CSP `connect_domains` / `resource_domains` / `base_uri_domains`
 *
 * Sources (all merged, deduplicated):
 *   - Constructor `origins: string[]`
 *   - `MCP_ALLOWED_ORIGINS` env var (comma-separated)
 *   - `provider: () => string[] | Promise<string[]>` callback
 *   - `providerUrl: string` HTTP endpoint returning JSON `string[]`
 *
 * Provider freshness is driven by the HTTP layer:
 *   - `Cache-Control: max-age` / `s-maxage` / `stale-while-revalidate`
 *   - `ETag` / `Last-Modified` with conditional GET
 *   - Single-flight background refresh (SWR)
 *
 * Optional HMAC-signed push webhook allows instant invalidation
 * (`POST /mcp-use/internal/origins/refresh` — mounted in mcp-server.ts).
 *
 * Wildcard semantics: `*.example.com` matches exactly one label
 * (`a.example.com` yes, `a.b.example.com` no, `example.com` no). Same as
 * CSP host-source semantics. Bare `*` is rejected at parse time.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "./runtime.js";

/**
 * Object-form configuration for `allowedOrigins`.
 *
 * Used when the caller needs wildcards, dynamic providers, or the HMAC
 * push webhook. Plain `string[]` is still accepted by `MCPServer` for
 * fully backward-compatible static host validation.
 */
export interface AllowedOriginsConfig {
  /** Static allow-list entries. Supports exact origins and wildcard hostnames. */
  origins?: string[];
  /** Sync or async callback returning origins. Runs alongside providerUrl. */
  provider?: () => string[] | Promise<string[]>;
  /** HTTP endpoint returning JSON `string[]`. Honors Cache-Control / ETag. */
  providerUrl?: string;
  /** Bearer token sent to providerUrl as `Authorization: Bearer <token>`. */
  token?: string;
  /** Extra headers sent to providerUrl (e.g. tenant IDs). */
  headers?: Record<string, string>;
  /** Shared secret for the HMAC push webhook. Webhook is NOT mounted without this. */
  webhookSecret?: string;
  /** Seconds to wait before revalidating when provider sends no Cache-Control. Default 60. */
  fallbackRevalidateSeconds?: number;
}

/**
 * Parsed allow-list entry used for matching both Host headers and full origins.
 */
export interface OriginMatcher {
  raw: string;
  /** Scheme if the entry included one (e.g. "https"), otherwise undefined. */
  scheme?: string;
  /** Either "literal" or "wildcard". Wildcards match exactly one subdomain label. */
  kind: "literal" | "wildcard";
  /** Lowercase hostname. For wildcards, this is the full pattern (e.g. "*.example.com"). */
  hostname: string;
  /** Optional port (e.g. "3000"). */
  port?: string;
}

const WEBHOOK_PATH = "/mcp-use/internal/origins/refresh";
const WEBHOOK_REPLAY_WINDOW_SECONDS = 5 * 60;
const DEFAULT_FALLBACK_REVALIDATE_SECONDS = 60;
const INITIAL_FETCH_TIMEOUT_MS = 5000;

type ParsedCacheControl = {
  maxAgeSeconds?: number;
  staleWhileRevalidateSeconds?: number;
  noStore: boolean;
  noCache: boolean;
  mustRevalidate: boolean;
};

function parseCacheControl(
  header: string | null | undefined
): ParsedCacheControl {
  const result: ParsedCacheControl = {
    noStore: false,
    noCache: false,
    mustRevalidate: false,
  };
  if (!header) return result;
  for (const rawDirective of header.split(",")) {
    const directive = rawDirective.trim().toLowerCase();
    if (directive === "no-store") result.noStore = true;
    else if (directive === "no-cache") result.noCache = true;
    else if (directive === "must-revalidate") result.mustRevalidate = true;
    else if (directive.startsWith("s-maxage=")) {
      const n = Number(directive.slice("s-maxage=".length));
      if (Number.isFinite(n) && n >= 0) result.maxAgeSeconds = n;
    } else if (directive.startsWith("max-age=")) {
      if (result.maxAgeSeconds === undefined) {
        const n = Number(directive.slice("max-age=".length));
        if (Number.isFinite(n) && n >= 0) result.maxAgeSeconds = n;
      }
    } else if (directive.startsWith("stale-while-revalidate=")) {
      const n = Number(directive.slice("stale-while-revalidate=".length));
      if (Number.isFinite(n) && n >= 0) result.staleWhileRevalidateSeconds = n;
    }
  }
  return result;
}

/**
 * Parse one allow-list entry into a matcher.
 *
 * Accepts:
 *   - "https://app.example.com"
 *   - "http://localhost:3000"
 *   - "*.preview.example.com"        (implicit https)
 *   - "https://*.preview.example.com"
 *   - "app.example.com"              (hostname only, any scheme)
 *
 * Rejects:
 *   - "*"                             (too broad)
 *   - "**.example.com"                (only one wildcard label allowed)
 *   - "*.co" / "*.com"                (TLD-only wildcards — still reject bare-TLD to reduce foot-guns)
 *   - invalid URLs
 */
export function parseAllowedOrigin(entry: string): OriginMatcher | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed === "*") {
    console.warn(
      `[OriginResolver] rejected bare "*" entry (too broad); use a specific hostname or wildcard like "*.example.com"`
    );
    return null;
  }

  // Pre-strip scheme for our own parsing — URL parser rejects wildcards in host.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  let scheme: string | undefined;
  let rest = trimmed;
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    rest = trimmed.slice(schemeMatch[0].length);
  }

  // Strip path/query if someone pasted a full URL with a path.
  const slashIdx = rest.indexOf("/");
  if (slashIdx >= 0) rest = rest.slice(0, slashIdx);

  // Split host:port (IPv6 not supported here — allow-list entries are hostnames).
  let host = rest;
  let port: string | undefined;
  const portIdx = rest.lastIndexOf(":");
  if (portIdx > 0 && !rest.slice(portIdx + 1).match(/[^0-9]/)) {
    host = rest.slice(0, portIdx);
    port = rest.slice(portIdx + 1);
  }

  host = host.toLowerCase();
  if (!host) return null;

  const wildcardCount = (host.match(/\*/g) ?? []).length;
  if (wildcardCount === 0) {
    return {
      raw: trimmed,
      scheme,
      kind: "literal",
      hostname: host,
      port,
    };
  }

  if (wildcardCount > 1 || !host.startsWith("*.")) {
    console.warn(
      `[OriginResolver] rejected wildcard entry "${trimmed}" — only one leading "*." label is allowed`
    );
    return null;
  }

  // Require at least two more labels (e.g. "*.example.com" OK, "*.com" rejected).
  const rest2 = host.slice(2);
  if (!rest2.includes(".")) {
    console.warn(
      `[OriginResolver] rejected wildcard entry "${trimmed}" — suffix must include at least two labels (e.g. "*.example.com")`
    );
    return null;
  }

  return {
    raw: trimmed,
    scheme,
    kind: "wildcard",
    hostname: host,
    port,
  };
}

function matcherMatchesHostname(m: OriginMatcher, hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (m.kind === "literal") return m.hostname === h;
  // Wildcard: "*.example.com" matches exactly one label.
  const suffix = m.hostname.slice(1); // ".example.com"
  if (!h.endsWith(suffix)) return false;
  const prefix = h.slice(0, h.length - suffix.length);
  if (prefix.length === 0) return false; // bare "example.com" shouldn't match "*.example.com"
  if (prefix.includes(".")) return false; // only one label allowed
  return true;
}

function matcherMatchesOrigin(
  m: OriginMatcher,
  origin: { scheme: string; hostname: string; port?: string }
): boolean {
  if (m.scheme && m.scheme !== origin.scheme) return false;
  if (m.port && m.port !== (origin.port ?? "")) return false;
  return matcherMatchesHostname(m, origin.hostname);
}

function splitEnvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseOriginFromString(raw: string | undefined): {
  scheme: string;
  hostname: string;
  port?: string;
} | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      scheme: url.protocol.replace(/:$/, "").toLowerCase(),
      hostname: url.hostname.toLowerCase(),
      port: url.port || undefined,
    };
  } catch {
    // Not a full URL — try treating as host[:port]
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const portIdx = trimmed.lastIndexOf(":");
    if (portIdx > 0 && !trimmed.slice(portIdx + 1).match(/[^0-9]/)) {
      return {
        scheme: "http",
        hostname: trimmed.slice(0, portIdx).toLowerCase(),
        port: trimmed.slice(portIdx + 1),
      };
    }
    return {
      scheme: "http",
      hostname: trimmed.toLowerCase(),
    };
  }
}

/**
 * Split a hostname string (e.g. from a Host header) into hostname + optional port.
 */
function splitHostHeader(
  hostHeader: string
): { hostname: string; port?: string } | null {
  const trimmed = hostHeader.trim();
  if (!trimmed) return null;
  // IPv6 in brackets — not allowed in allow-list entries either.
  if (trimmed.startsWith("[")) {
    const closing = trimmed.indexOf("]");
    if (closing < 0) return null;
    const host = trimmed.slice(1, closing);
    const portPart = trimmed.slice(closing + 1);
    const port =
      portPart.startsWith(":") && /^:[0-9]+$/.test(portPart)
        ? portPart.slice(1)
        : undefined;
    return { hostname: host.toLowerCase(), port };
  }
  const idx = trimmed.lastIndexOf(":");
  if (idx > 0 && !trimmed.slice(idx + 1).match(/[^0-9]/)) {
    return {
      hostname: trimmed.slice(0, idx).toLowerCase(),
      port: trimmed.slice(idx + 1),
    };
  }
  return { hostname: trimmed.toLowerCase() };
}

/**
 * Structural result used by the host validation middleware and widget read path.
 */
export interface ResolveResult {
  /** The origin we'll use for widget <base> / CSP. Always set. */
  origin: string;
  /** True if the request's Host matched the allow-list. */
  isAllowed: boolean;
  /** Hostname of the incoming request (lowercased), or null if missing. */
  requestHostname: string | null;
}

/**
 * Public API of the resolver consumed by middleware, widgets, and the webhook handler.
 */
export class OriginResolver {
  private readonly staticMatchers: OriginMatcher[] = [];
  private readonly staticOriginStrings: string[] = [];
  private readonly providerMatchers: OriginMatcher[] = [];
  private providerOriginStrings: string[] = [];

  private readonly config: AllowedOriginsConfig;
  private readonly providerUrl: string | undefined;
  private readonly token: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly extraHeaders: Record<string, string>;
  private readonly fallbackRevalidateSeconds: number;
  /** If true, the user configured at least a static list or provider. */
  private readonly enabled: boolean;
  /** If true, the user configured a dynamic source (provider / providerUrl / webhook). */
  private readonly dynamic: boolean;
  /**
   * Fallback origin used for widget output when the request Host is not
   * allow-listed (typically the configured baseUrl / MCP_URL / host:port).
   */
  private fallbackOrigin: string | null = null;

  // HTTP cache state for providerUrl.
  private lastETag: string | undefined;
  private lastModified: string | undefined;
  private cacheExpiresAtMs = 0;
  private staleUntilMs = 0;
  private inFlightRefresh: Promise<void> | null = null;
  private hasInitialFetch = false;
  private initialFetchFailed = false;
  private lastProviderError: Error | null = null;
  private lastLoggedFailureAtMs = 0;

  constructor(
    rawConfig: string[] | AllowedOriginsConfig | undefined,
    opts: { fallbackOrigin?: string | null } = {}
  ) {
    const envOrigins = splitEnvList(getEnv("MCP_ALLOWED_ORIGINS"));
    const envProviderUrl = getEnv("MCP_ALLOWED_ORIGINS_URL");
    const envToken = getEnv("MCP_ALLOWED_ORIGINS_TOKEN");
    const envWebhookSecret = getEnv("MCP_ALLOWED_ORIGINS_WEBHOOK_SECRET");

    if (rawConfig === undefined) {
      this.config = {};
    } else if (Array.isArray(rawConfig)) {
      this.config = { origins: rawConfig };
    } else {
      this.config = rawConfig;
    }

    this.providerUrl = this.config.providerUrl ?? envProviderUrl;
    this.token = this.config.token ?? envToken;
    this.webhookSecret = this.config.webhookSecret ?? envWebhookSecret;
    this.extraHeaders = this.config.headers ?? {};
    this.fallbackRevalidateSeconds =
      this.config.fallbackRevalidateSeconds ??
      DEFAULT_FALLBACK_REVALIDATE_SECONDS;
    this.fallbackOrigin = opts.fallbackOrigin ?? null;

    const staticOrigins = [...(this.config.origins ?? []), ...envOrigins];

    for (const entry of staticOrigins) {
      const m = parseAllowedOrigin(entry);
      if (m) {
        this.staticMatchers.push(m);
        this.staticOriginStrings.push(entry.trim());
      }
    }

    const hasProvider = Boolean(this.config.provider || this.providerUrl);
    this.dynamic = Boolean(
      hasProvider ||
      (rawConfig !== undefined &&
        !Array.isArray(rawConfig) &&
        this.webhookSecret)
    );
    this.enabled =
      this.staticMatchers.length > 0 ||
      hasProvider ||
      Boolean(this.webhookSecret);
  }

  /**
   * Update the fallback origin used when the request Host isn't allow-listed.
   * Called by MCPServer.listen() after MCP_URL / host:port is finalized.
   */
  setFallbackOrigin(origin: string | null): void {
    this.fallbackOrigin = origin;
  }

  getFallbackOrigin(): string | null {
    return this.fallbackOrigin;
  }

  /** Whether any allow-list mechanism is active. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Whether a dynamic source (provider / providerUrl / webhook) is configured. */
  isDynamic(): boolean {
    return this.dynamic;
  }

  /** Whether a push webhook is enabled (webhookSecret set). */
  hasWebhook(): boolean {
    return Boolean(this.webhookSecret);
  }

  /** Path where the resolver mounts its webhook (constant). */
  static readonly WEBHOOK_PATH = WEBHOOK_PATH;

  /**
   * Run the initial provider fetch (best-effort, time-boxed).
   *
   * After this resolves, `getMatchersSync()` returns the most complete
   * allow-list we can produce at cold start. Providers that fail to
   * respond within the timeout are logged; the server will continue with
   * just the static list (plus any subsequent successful refreshes).
   *
   * Safe to call on servers with no dynamic sources — it's a no-op then.
   */
  async init(timeoutMs: number = INITIAL_FETCH_TIMEOUT_MS): Promise<void> {
    if (!this.dynamic) return;
    try {
      await this.refreshOnce({ timeoutMs });
    } catch (err) {
      this.initialFetchFailed = true;
      this.lastProviderError = err as Error;
      console.warn(
        `[OriginResolver] initial provider fetch failed: ${(err as Error).message}; continuing with ${this.staticMatchers.length} static entries`
      );
    } finally {
      this.hasInitialFetch = true;
    }
  }

  /**
   * True if we have *nothing* to enforce with (fail-closed path for Host
   * validation on cold start). Only possible when a provider was configured
   * but failed AND no static origins were provided.
   */
  isColdStartFailure(): boolean {
    if (!this.dynamic) return false;
    if (this.staticMatchers.length > 0) return false;
    if (this.providerMatchers.length > 0) return false;
    return this.hasInitialFetch && this.initialFetchFailed;
  }

  /**
   * Return all matchers currently active (static + last-known-good provider).
   * Never blocks, never throws. Safe to call from hot paths (middleware).
   */
  getMatchersSync(): OriginMatcher[] {
    if (this.providerMatchers.length === 0) return this.staticMatchers;
    if (this.staticMatchers.length === 0) return this.providerMatchers;
    return [...this.staticMatchers, ...this.providerMatchers];
  }

  /**
   * Return the union of origin strings as currently known, preserving
   * wildcard patterns (e.g. `"https://*.example.com"`) as written. Used
   * to populate widget CSP arrays.
   */
  getAllowedOriginStringsSync(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of this.staticOriginStrings) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    for (const s of this.providerOriginStrings) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }

  /**
   * Return just the hostnames (lowercased, wildcard patterns preserved) for
   * use by the host-validation middleware.
   */
  getAllowedHostnamesSync(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of this.getMatchersSync()) {
      if (!seen.has(m.hostname)) {
        seen.add(m.hostname);
        out.push(m.hostname);
      }
    }
    return out;
  }

  matchesHostname(hostname: string): boolean {
    for (const m of this.getMatchersSync()) {
      if (matcherMatchesHostname(m, hostname)) return true;
    }
    return false;
  }

  /**
   * Does any matcher match this full origin (scheme + host + optional port)?
   */
  matchesOrigin(originString: string): boolean {
    const parsed = parseOriginFromString(originString);
    if (!parsed) return false;
    for (const m of this.getMatchersSync()) {
      if (matcherMatchesOrigin(m, parsed)) return true;
    }
    return false;
  }

  /**
   * Resolve the effective origin to use for a given Request, consulting the
   * Host header (NOT X-Forwarded-Host — that bypass is reserved for a future
   * trustedProxies option).
   */
  resolveRequest(req: {
    headers: { get(name: string): string | null };
    url?: string;
  }): ResolveResult {
    const hostHeader = req.headers.get("host") || req.headers.get("Host");
    let requestHostname: string | null = null;
    let requestPort: string | undefined;
    if (hostHeader) {
      const parts = splitHostHeader(hostHeader);
      if (parts) {
        requestHostname = parts.hostname;
        requestPort = parts.port;
      }
    }

    if (!requestHostname) {
      return {
        origin: this.fallbackOrigin ?? "",
        isAllowed: false,
        requestHostname: null,
      };
    }

    // Derive scheme from the request URL when possible, else fall back to
    // the fallback origin's scheme (or http).
    let scheme = "http";
    if (req.url) {
      try {
        scheme = new URL(req.url).protocol.replace(/:$/, "").toLowerCase();
      } catch {
        // ignore
      }
    }
    if (scheme === "http" && this.fallbackOrigin) {
      try {
        scheme = new URL(this.fallbackOrigin).protocol
          .replace(/:$/, "")
          .toLowerCase();
      } catch {
        // ignore
      }
    }

    const candidate = {
      scheme,
      hostname: requestHostname,
      port: requestPort,
    };

    let isAllowed = false;
    for (const m of this.getMatchersSync()) {
      if (matcherMatchesOrigin(m, candidate)) {
        isAllowed = true;
        break;
      }
    }

    if (!isAllowed) {
      // Fallback origin is always implicitly allowed for widget output.
      return {
        origin: this.fallbackOrigin ?? "",
        isAllowed: false,
        requestHostname,
      };
    }

    const originOut = candidate.port
      ? `${scheme}://${requestHostname}:${candidate.port}`
      : `${scheme}://${requestHostname}`;

    return {
      origin: originOut,
      isAllowed: true,
      requestHostname,
    };
  }

  /**
   * Refresh the provider list if stale. Called opportunistically by the
   * widget read path (and by the webhook handler in "revalidate" mode).
   * Non-blocking — returns the current in-flight refresh if any, else
   * kicks off a new one (single-flight).
   */
  refreshIfStale(): Promise<void> {
    if (!this.dynamic) return Promise.resolve();
    const now = Date.now();
    if (now < this.cacheExpiresAtMs) return Promise.resolve();
    if (this.inFlightRefresh) return this.inFlightRefresh;
    this.inFlightRefresh = this.refreshOnce().finally(() => {
      this.inFlightRefresh = null;
    });
    // Fire-and-forget from the caller's perspective; don't let background
    // refresh reject promises bubble up.
    this.inFlightRefresh.catch(() => {});
    return this.inFlightRefresh;
  }

  /**
   * Force-invalidate the cache and trigger a refresh. Used by the webhook
   * handler when the payload doesn't carry an inline origins list.
   */
  invalidateAndRefresh(): Promise<void> {
    this.cacheExpiresAtMs = 0;
    this.staleUntilMs = 0;
    return this.refreshIfStale();
  }

  /**
   * Replace the provider list in-memory (used by the webhook when the
   * payload carries an inline origins list — no outbound fetch needed).
   */
  applyInlineOrigins(origins: string[]): void {
    const matchers: OriginMatcher[] = [];
    const strings: string[] = [];
    for (const entry of origins) {
      const m = parseAllowedOrigin(entry);
      if (m) {
        matchers.push(m);
        strings.push(entry.trim());
      }
    }
    this.providerMatchers.length = 0;
    this.providerMatchers.push(...matchers);
    this.providerOriginStrings = strings;
    // Treat inline updates as "fresh" for the full fallback window so we
    // don't immediately refetch on the next request.
    const now = Date.now();
    this.cacheExpiresAtMs = now + this.fallbackRevalidateSeconds * 1000;
    this.staleUntilMs = this.cacheExpiresAtMs;
    this.hasInitialFetch = true;
    this.initialFetchFailed = false;
  }

  /**
   * Internal refresh: runs provider callback + providerUrl, merges, updates
   * last-known-good + cache expiry.
   */
  private async refreshOnce(opts: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = opts.timeoutMs;
    const tasks: Array<Promise<string[]>> = [];
    if (this.config.provider) {
      tasks.push(
        Promise.resolve()
          .then(() => this.config.provider!())
          .then((v) => (Array.isArray(v) ? v : []))
      );
    }
    if (this.providerUrl) {
      tasks.push(this.fetchProviderUrl(timeoutMs));
    }

    if (tasks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(tasks);

    const merged: string[] = [];
    let anyFailed = false;
    let anySuccess = false;
    for (const r of results) {
      if (r.status === "fulfilled") {
        anySuccess = true;
        for (const entry of r.value) merged.push(entry);
      } else {
        anyFailed = true;
        this.logProviderFailure(r.reason as Error);
      }
    }

    // Only update last-known-good when we got SOMETHING.
    if (anySuccess) {
      const matchers: OriginMatcher[] = [];
      const strings: string[] = [];
      const seen = new Set<string>();
      for (const entry of merged) {
        const trimmed = entry.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        const m = parseAllowedOrigin(trimmed);
        if (m) {
          matchers.push(m);
          strings.push(trimmed);
          seen.add(trimmed);
        }
      }
      this.providerMatchers.length = 0;
      this.providerMatchers.push(...matchers);
      this.providerOriginStrings = strings;
    }

    if (anyFailed && !anySuccess) {
      // Bubble up for init() to record cold-start failure; background
      // refresh swallows it (we've already logged).
      if (!this.hasInitialFetch) {
        throw (
          results.find((r) => r.status === "rejected")?.reason ??
          new Error("provider failed")
        );
      }
    }
  }

  private logProviderFailure(err: Error): void {
    this.lastProviderError = err;
    const now = Date.now();
    if (now - this.lastLoggedFailureAtMs > 60_000) {
      this.lastLoggedFailureAtMs = now;
      console.warn(`[OriginResolver] provider refresh failed: ${err.message}`);
    }
  }

  /**
   * Conditional GET against providerUrl. Updates ETag/Last-Modified/cache
   * expiry from response headers. Returns the parsed list on 200; on 304,
   * resolves with the current `providerOriginStrings` (caller merges).
   */
  private async fetchProviderUrl(timeoutMs?: number): Promise<string[]> {
    if (!this.providerUrl) return [];
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.extraHeaders,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.lastETag) headers["If-None-Match"] = this.lastETag;
    if (this.lastModified) headers["If-Modified-Since"] = this.lastModified;

    const controller = new AbortController();
    const timer = timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    let res: Response;
    try {
      res = await fetch(this.providerUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const now = Date.now();
    const cc = parseCacheControl(res.headers.get("cache-control"));
    const maxAgeSec = cc.maxAgeSeconds ?? this.fallbackRevalidateSeconds;
    const swrSec = cc.staleWhileRevalidateSeconds ?? 0;

    if (cc.noStore) {
      this.cacheExpiresAtMs = 0;
      this.staleUntilMs = 0;
    } else {
      this.cacheExpiresAtMs = cc.noCache ? 0 : now + maxAgeSec * 1000;
      this.staleUntilMs = this.cacheExpiresAtMs + swrSec * 1000;
    }

    if (res.status === 304) {
      // Keep last-known-good; nothing to merge.
      return this.providerOriginStrings;
    }
    if (!res.ok) {
      throw new Error(
        `providerUrl ${this.providerUrl} returned ${res.status} ${res.statusText}`
      );
    }

    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    if (etag) this.lastETag = etag;
    if (lastModified) this.lastModified = lastModified;

    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new Error(
        `providerUrl ${this.providerUrl} did not return a JSON array`
      );
    }
    const out: string[] = [];
    for (const v of json) {
      if (typeof v === "string") out.push(v);
    }
    return out;
  }

  /**
   * Verify an incoming webhook request. The caller (mcp-server.ts) wires
   * this to `POST /mcp-use/internal/origins/refresh`. Returns a shape
   * the route handler turns into the HTTP response.
   */
  async handleWebhook(opts: {
    signatureHeader: string | null;
    rawBody: string;
    now?: number;
  }): Promise<{ status: number; body?: string }> {
    if (!this.webhookSecret) {
      return { status: 404, body: "webhook disabled" };
    }
    const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
    const sig = opts.signatureHeader?.trim();
    if (!sig) return { status: 401, body: "missing signature" };

    const parts = Object.fromEntries(
      sig.split(",").map((p) => {
        const idx = p.indexOf("=");
        if (idx < 0) return [p.trim(), ""];
        return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
      })
    ) as Record<string, string>;

    const tStr = parts["t"];
    const v1 = parts["v1"];
    if (!tStr || !v1) return { status: 401, body: "malformed signature" };

    const t = Number(tStr);
    if (!Number.isFinite(t))
      return { status: 401, body: "malformed timestamp" };
    if (Math.abs(nowSec - t) > WEBHOOK_REPLAY_WINDOW_SECONDS) {
      return { status: 401, body: "stale signature" };
    }

    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${tStr}.${opts.rawBody}`)
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(v1, "utf8");
    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return { status: 401, body: "signature mismatch" };
    }

    // Signature OK. Parse body — empty body == "invalidate + refetch".
    if (opts.rawBody.trim().length > 0) {
      let payload: unknown;
      try {
        payload = JSON.parse(opts.rawBody);
      } catch {
        return { status: 400, body: "invalid JSON body" };
      }
      const origins =
        payload && typeof payload === "object" && payload !== null
          ? (payload as { origins?: unknown }).origins
          : undefined;
      if (Array.isArray(origins)) {
        const list: string[] = [];
        for (const v of origins) if (typeof v === "string") list.push(v);
        this.applyInlineOrigins(list);
        return { status: 204 };
      }
    }

    // No inline origins — invalidate cache so the next read triggers a refetch.
    await this.invalidateAndRefresh();
    return { status: 204 };
  }
}

export { parseCacheControl, matcherMatchesHostname, matcherMatchesOrigin };
