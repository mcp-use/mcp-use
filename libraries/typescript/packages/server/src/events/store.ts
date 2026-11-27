/**
 * Storage for MCP Events subscriptions, pending deliveries and the poll log:
 * an in-memory store for tests, a JSON file store for `mcp-use dev`, and
 * Redis over the Upstash REST protocol (Upstash, Manufact Cloud's Redis
 * proxy, or any compatible endpoint).
 */

/** The small Redis subset MCP Events needs. Values are strings. */
export interface EventsStore {
  /** Value at `key`, or `null` when missing or expired. */
  get(key: string): Promise<string | null>;
  /** Set a value, optionally expiring after `ttlMs`. */
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  /** Delete `key`, whatever it holds; a missing key is a no-op. */
  del(key: string): Promise<void>;
  /** Increment an integer counter and return the new value. */
  incr(key: string): Promise<number>;
  /** Add `member` to the set at `key`. */
  sadd(key: string, member: string): Promise<void>;
  /** Remove `member` from the set at `key`. */
  srem(key: string, member: string): Promise<void>;
  /** All members of the set at `key`, in no particular order. */
  smembers(key: string): Promise<string[]>;
  /** Add `member` to the sorted set at `key`, or update its `score`. */
  zadd(key: string, score: number, member: string): Promise<void>;
  /** Members with a score up to `max`, lowest first, at most `limit`. */
  zdue(key: string, max: number, limit: number): Promise<string[]>;
  /** Members with a score above `min` (exclusive), lowest first, at most `limit`. */
  zafter(key: string, min: number, limit: number): Promise<string[]>;
  /** Members by rank, lowest score first (Redis `ZRANGE` index semantics). */
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  /** Remove a member; `true` when this call removed it (a claim). */
  zrem(key: string, member: string): Promise<boolean>;
}

/** Plain-JSON state behind the memory and file stores. */
interface State {
  kv: Record<string, [string, number | null]>;
  sets: Record<string, string[]>;
  zsets: Record<string, Record<string, number>>;
}

const empty = (): State => ({ kv: {}, sets: {}, zsets: {} });

function sorted(z: Record<string, number> | undefined): [string, number][] {
  return Object.entries(z ?? {}).sort((a, b) => a[1] - b[1]);
}

function live(e: [string, number | null] | undefined): string | null {
  return e && (e[1] === null || e[1] > Date.now()) ? e[0] : null;
}

/** A store over a state that `load` returns and `save` persists after writes. */
function stateStore(
  load: () => Promise<State>,
  save: (state: State) => Promise<void>
): EventsStore {
  const read = async <T>(fn: (s: State) => T) => fn(await load());
  // Writes run one at a time so a load-modify-save never loses an update.
  let queue: Promise<unknown> = Promise.resolve();
  const write = <T>(fn: (s: State) => T): Promise<T> => {
    const run = queue.then(async () => {
      const s = await load();
      const out = fn(s);
      await save(s);
      return out;
    });
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    get: (key) => read((s) => live(s.kv[key])),
    set: (key, value, ttlMs) =>
      write((s) => {
        s.kv[key] = [value, ttlMs ? Date.now() + ttlMs : null];
      }),
    del: (key) =>
      write((s) => {
        delete s.kv[key];
      }),
    incr: (key) =>
      write((s) => {
        const n = Number(live(s.kv[key]) ?? 0) + 1;
        s.kv[key] = [String(n), s.kv[key]?.[1] ?? null];
        return n;
      }),
    sadd: (key, member) =>
      write((s) => {
        s.sets[key] = [...new Set(s.sets[key]).add(member)];
      }),
    srem: (key, member) =>
      write((s) => {
        s.sets[key] = (s.sets[key] ?? []).filter((m) => m !== member);
      }),
    smembers: (key) => read((s) => [...(s.sets[key] ?? [])]),
    zadd: (key, score, member) =>
      write((s) => {
        (s.zsets[key] ??= {})[member] = score;
      }),
    zdue: (key, max, limit) =>
      read((s) =>
        sorted(s.zsets[key])
          .filter(([, x]) => x <= max)
          .slice(0, limit)
          .map(([m]) => m)
      ),
    zafter: (key, min, limit) =>
      read((s) =>
        sorted(s.zsets[key])
          .filter(([, x]) => x > min)
          .slice(0, limit)
          .map(([m]) => m)
      ),
    zrange: (key, start, stop) =>
      read((s) => {
        const all = sorted(s.zsets[key]).map(([m]) => m);
        const n = all.length;
        const from = start < 0 ? Math.max(n + start, 0) : start;
        const to = stop < 0 ? n + stop : stop;
        return to < from ? [] : all.slice(from, to + 1);
      }),
    zrem: (key, member) =>
      write((s) => {
        const z = s.zsets[key];
        if (z === undefined || !(member in z)) return false;
        delete z[member];
        return true;
      }),
  };
}

/**
 * An in-process store. State is lost on restart; use it for development and
 * tests only.
 */
export function memoryEventsStore(): EventsStore {
  const state = empty();
  return stateStore(
    async () => state,
    async () => undefined
  );
}

/**
 * A JSON file store for local development: `mcp-use dev` uses it so
 * subscriptions survive hot reloads and restarts. Node only, single process.
 *
 * @param dir - Directory that holds `store.json`.
 */
export function fileEventsStore(dir: string): EventsStore {
  const fs = import("node:fs");
  const file = `${dir.replace(/[\\/]+$/, "")}/store.json`;
  return stateStore(
    async () => {
      const { readFileSync } = await fs;
      try {
        return {
          ...empty(),
          ...(JSON.parse(readFileSync(file, "utf8")) as State),
        };
      } catch {
        return empty();
      }
    },
    async (state) => {
      const { mkdirSync, renameSync, writeFileSync } = await fs;
      for (const [k, e] of Object.entries(state.kv))
        if (live(e) === null) delete state.kv[k];
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, file);
    }
  );
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
  const list = async (...args: (string | number)[]) =>
    ((await cmd(...args)) as string[] | null) ?? [];
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
    async incr(key) {
      return Number(await cmd("INCR", p + key));
    },
    async sadd(key, member) {
      await cmd("SADD", p + key, member);
    },
    async srem(key, member) {
      await cmd("SREM", p + key, member);
    },
    smembers: (key) => list("SMEMBERS", p + key),
    async zadd(key, score, member) {
      await cmd("ZADD", p + key, score, member);
    },
    zdue: (key, max, limit) =>
      list("ZRANGEBYSCORE", p + key, "-inf", max, "LIMIT", 0, limit),
    zafter: (key, min, limit) =>
      list("ZRANGEBYSCORE", p + key, `(${min}`, "+inf", "LIMIT", 0, limit),
    zrange: (key, start, stop) => list("ZRANGE", p + key, start, stop),
    async zrem(key, member) {
      return Number(await cmd("ZREM", p + key, member)) === 1;
    },
  };
}
