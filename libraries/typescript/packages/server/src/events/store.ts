/**
 * Storage for MCP Events subscriptions and pending deliveries: an in-memory
 * store for development and tests, and Redis over the Upstash REST protocol
 * (Upstash, Manufact Cloud's Redis proxy, or any compatible endpoint).
 */

/** The small Redis subset MCP Events needs. Values are strings. */
export interface EventsStore {
  get(key: string): Promise<string | null>;
  /** Set a value, optionally expiring after `ttlMs`. */
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<void>;
  /** Members with a score up to `max`, lowest first, at most `limit`. */
  zdue(key: string, max: number, limit: number): Promise<string[]>;
  /** Remove a member; `true` when this call removed it (a claim). */
  zrem(key: string, member: string): Promise<boolean>;
}

/**
 * An in-process store. State is lost on restart; use it for development and
 * tests only.
 */
export function memoryEventsStore(): EventsStore {
  const kv = new Map<string, { value: string; expires: number }>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number>>();
  const set = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  const zset = (k: string) => zsets.get(k) ?? zsets.set(k, new Map()).get(k)!;
  return {
    async get(key) {
      const e = kv.get(key);
      if (e === undefined) return null;
      if (e.expires <= Date.now()) {
        kv.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, ttlMs) {
      kv.set(key, { value, expires: ttlMs ? Date.now() + ttlMs : Infinity });
    },
    async del(key) {
      kv.delete(key);
    },
    async sadd(key, member) {
      set(key).add(member);
    },
    async srem(key, member) {
      set(key).delete(member);
    },
    async smembers(key) {
      return [...set(key)];
    },
    async zadd(key, score, member) {
      zset(key).set(member, score);
    },
    async zdue(key, max, limit) {
      return [...zset(key)]
        .filter(([, s]) => s <= max)
        .sort((a, b) => a[1] - b[1])
        .slice(0, limit)
        .map(([m]) => m);
    },
    async zrem(key, member) {
      return zset(key).delete(member);
    },
  };
}

/** Options for {@link upstashEventsStore}. */
export interface UpstashEventsStoreOptions {
  /** REST endpoint, for example `https://<db>.upstash.io`. */
  url: string;
  /** REST bearer token. */
  token: string;
  /** Prefix for every key. */
  prefix?: string;
  /** Custom fetch. */
  fetch?: typeof fetch;
}

/**
 * Redis over the Upstash REST protocol: each command is a JSON array POSTed
 * to the endpoint with a bearer token.
 *
 * @param options - Endpoint, token and key prefix.
 */
export function upstashEventsStore(
  options: UpstashEventsStoreOptions
): EventsStore {
  if (!options.url || !options.token)
    throw new TypeError("upstashEventsStore requires url and token");
  const url = options.url.replace(/\/+$/, "");
  const p = options.prefix ?? "";
  const doFetch = options.fetch ?? ((i, init) => fetch(i, init));
  const cmd = async (...args: (string | number)[]): Promise<unknown> => {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args.map(String)),
    });
    const json = (await res.json().catch(() => ({}))) as {
      result?: unknown;
      error?: string;
    };
    if (!res.ok || json.error !== undefined)
      throw new Error(`events store: ${json.error ?? `HTTP ${res.status}`}`);
    return json.result;
  };
  return {
    async get(key) {
      return ((await cmd("GET", p + key)) as string | null) ?? null;
    },
    async set(key, value, ttlMs) {
      await (ttlMs
        ? cmd("SET", p + key, value, "PX", Math.ceil(ttlMs))
        : cmd("SET", p + key, value));
    },
    async del(key) {
      await cmd("DEL", p + key);
    },
    async sadd(key, member) {
      await cmd("SADD", p + key, member);
    },
    async srem(key, member) {
      await cmd("SREM", p + key, member);
    },
    async smembers(key) {
      return ((await cmd("SMEMBERS", p + key)) as string[] | null) ?? [];
    },
    async zadd(key, score, member) {
      await cmd("ZADD", p + key, score, member);
    },
    async zdue(key, max, limit) {
      return (
        ((await cmd(
          "ZRANGEBYSCORE",
          p + key,
          "-inf",
          max,
          "LIMIT",
          0,
          limit
        )) as string[] | null) ?? []
      );
    },
    async zrem(key, member) {
      return Number(await cmd("ZREM", p + key, member)) === 1;
    },
  };
}
