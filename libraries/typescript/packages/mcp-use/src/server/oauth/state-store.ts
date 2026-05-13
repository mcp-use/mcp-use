/**
 * OAuth Proxy State Store
 *
 * Tracks in-flight authorization requests between `/authorize` and
 * `/oauth/callback` in proxy mode. The proxy generates a random key, stores
 * the original client `redirect_uri` and `state`, and forwards its own key
 * as the upstream `state`. On callback, the proxy retrieves the record and
 * redirects to the original client URI with the original state value.
 *
 * Records are consumed on read (one-shot) and expire after a configurable
 * TTL. The default in-memory implementation works for single-instance
 * deployments. For multi-replica setups, implement {@link OAuthStateStore}
 * against a shared backend (Redis, etc.) and pass it to `setupOAuthRoutes`.
 */

/**
 * Record stored against an in-flight proxy state key.
 */
export interface OAuthStateRecord {
  /** Original client-supplied redirect URI. */
  clientRedirectUri: string;
  /** Original client-supplied `state` value, if any. */
  clientState?: string;
}

/**
 * Pluggable storage for in-flight OAuth proxy authorization state.
 *
 * Implementations must enforce the TTL passed to {@link set}. {@link get}
 * must atomically delete the record so each state can only be consumed once.
 */
export interface OAuthStateStore {
  /**
   * Store a record under `key`. The record must be discarded after `ttlMs`
   * milliseconds.
   */
  set(
    key: string,
    record: OAuthStateRecord,
    ttlMs: number
  ): Promise<void> | void;

  /**
   * Retrieve and delete the record stored under `key`. Returns null if no
   * record exists or it has expired.
   */
  get(key: string): Promise<OAuthStateRecord | null> | OAuthStateRecord | null;
}

interface StoredEntry {
  record: OAuthStateRecord;
  expiresAt: number;
}

/**
 * Default in-memory {@link OAuthStateStore} backed by a `Map`. Suitable for
 * single-process MCP servers. Entries are lazily expired on read.
 */
export function createInMemoryStateStore(): OAuthStateStore {
  const entries = new Map<string, StoredEntry>();

  return {
    set(key, record, ttlMs) {
      entries.set(key, {
        record,
        expiresAt: Date.now() + ttlMs,
      });
    },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      entries.delete(key);
      if (entry.expiresAt < Date.now()) return null;
      return entry.record;
    },
  };
}

/**
 * Default TTL for in-flight authorization records (10 minutes).
 */
export const DEFAULT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
