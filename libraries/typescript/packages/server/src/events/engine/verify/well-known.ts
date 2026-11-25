/**
 * Well-known strategy (D29): `/.well-known/mcp-webhook-receiver.json` on the
 * callback origin, e.g. `{"receivers": ["/hooks/"]}`, fetched through the
 * SSRF-hardened path (and the egress proxy), no redirects, cached per origin
 * respecting HTTP caching capped at 24 h.
 *
 * @internal
 */

import type { Clock } from "../../internal/clock.js";

/** The well-known path. */
export const WELL_KNOWN_RECEIVER_PATH =
  "/.well-known/mcp-webhook-receiver.json";

/** A GET through the SSRF-hardened path; never follows redirects. */
export type WellKnownFetch = (
  url: string,
  o: { timeoutMs: number; signal?: AbortSignal }
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

const CAP_MS = 24 * 3_600_000;
const NEGATIVE_MS = 60_000;

/** Cache lifetime from `Cache-Control` (max-age, no-store), capped at 24 h. */
export function cacheTtl(headers: Record<string, string>): number {
  const cc = (
    headers["cache-control"] ??
    headers["Cache-Control"] ??
    ""
  ).toLowerCase();
  if (/no-store|no-cache/.test(cc)) return 0;
  const m = /max-age=(\d+)/.exec(cc);
  return m ? Math.min(Number(m[1]) * 1000, CAP_MS) : CAP_MS;
}

/** Per-origin cache of receiver documents (per process). */
export class WellKnownCache {
  readonly #entries = new Map<
    string,
    { receivers: string[] | null; until: number }
  >();
  readonly #fetch: WellKnownFetch;
  readonly #clock: Clock;

  /** Create a cache over a GET function and a clock. */
  constructor(fetchDoc: WellKnownFetch, clock: Clock) {
    this.#fetch = fetchDoc;
    this.#clock = clock;
  }

  /**
   * Whether the receiver document on the URL's origin lists a path prefix
   * covering the URL's path.
   */
  async covers(
    url: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const receivers = await this.#receivers(u.origin, timeoutMs, signal);
    if (!receivers) return false;
    return receivers.some((p) => p.startsWith("/") && u.pathname.startsWith(p));
  }

  async #receivers(
    origin: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<string[] | null> {
    const now = this.#clock.now();
    const hit = this.#entries.get(origin);
    if (hit && hit.until > now) return hit.receivers;
    let receivers: string[] | null = null;
    let ttl = NEGATIVE_MS;
    try {
      const r = await this.#fetch(origin + WELL_KNOWN_RECEIVER_PATH, {
        timeoutMs,
        ...(signal ? { signal } : {}),
      });
      if (r.status >= 200 && r.status < 300) {
        const doc = JSON.parse(r.body) as { receivers?: unknown };
        if (Array.isArray(doc.receivers)) {
          receivers = doc.receivers.filter(
            (x): x is string => typeof x === "string"
          );
          ttl = cacheTtl(r.headers);
        }
      }
    } catch {
      receivers = null;
    }
    this.#entries.set(origin, { receivers, until: now + ttl });
    return receivers;
  }
}
