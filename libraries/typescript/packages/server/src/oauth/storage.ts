/**
 * Storage adapters for the OAuth proxy (`oauthProxy` in `mcp-use/oauth`).
 *
 * Each adapter takes a client or binding that the application already has,
 * so this package adds no database dependency. The proxy encrypts every
 * value before an adapter sees it.
 *
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "./proxy/storage.js";

export { memoryStorage, type OAuthProxyStorage } from "./proxy/storage.js";

// ─── Upstash (REST) ──────────────────────────────────────────────────────

/** Options for {@link upstashStorage}. */
export interface UpstashStorageOptions {
  /** REST URL of the database, for example `UPSTASH_REDIS_REST_URL`. */
  url: string;
  /** REST token of the database, for example `UPSTASH_REDIS_REST_TOKEN`. */
  token: string;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Creates a store on Upstash Redis over its REST API. It needs only `fetch`,
 * so it runs on Node, Vercel, and Cloudflare Workers alike.
 *
 * @param options - REST URL and token of the database.
 * @returns A store for `oauthProxy`.
 */
export function upstashStorage(
  options: UpstashStorageOptions
): OAuthProxyStorage {
  if (typeof options?.url !== "string" || typeof options.token !== "string") {
    throw new TypeError("upstashStorage requires url and token");
  }
  const url = options.url.replace(/\/+$/, "");
  const fetchImpl =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const command = async (args: (string | number)[]): Promise<unknown> => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args.map(String)),
    });
    const body = (await response.json().catch(() => ({}))) as {
      result?: unknown;
      error?: string;
    };
    if (!response.ok || body.error !== undefined) {
      throw new Error(
        `Upstash ${String(args[0])} failed: ${body.error ?? response.status}`
      );
    }
    return body.result;
  };
  return redisCommandStorage(command);
}

// ─── Redis (node-redis or ioredis) ───────────────────────────────────────

/** A node-redis (v4+) client: anything with `sendCommand(args)`. */
export interface NodeRedisLikeClient {
  /** Sends a raw command, for example `["GET", "key"]`. */
  sendCommand(args: string[]): Promise<unknown>;
}

/** An ioredis client: anything with `call(command, ...args)`. */
export interface IORedisLikeClient {
  /** Sends a raw command, for example `call("GET", "key")`. */
  call(command: string, ...args: string[]): Promise<unknown>;
}

/**
 * Creates a store on Redis (6.2 or later) through an existing node-redis or
 * ioredis client.
 *
 * @param client - A connected node-redis or ioredis client.
 * @returns A store for `oauthProxy`.
 *
 * @example
 * ```ts
 * import { createClient } from "redis";
 * import { redisStorage } from "mcp-use/oauth/storage";
 *
 * const redis = await createClient({ url: process.env.REDIS_URL }).connect();
 * const storage = redisStorage(redis);
 * ```
 */
export function redisStorage(
  client: NodeRedisLikeClient | IORedisLikeClient
): OAuthProxyStorage {
  if (client !== null && typeof client === "object") {
    if (typeof (client as NodeRedisLikeClient).sendCommand === "function") {
      const redis = client as NodeRedisLikeClient;
      return redisCommandStorage((args) => redis.sendCommand(args.map(String)));
    }
    if (typeof (client as IORedisLikeClient).call === "function") {
      const redis = client as IORedisLikeClient;
      return redisCommandStorage(([name, ...args]) =>
        redis.call(String(name), ...args.map(String))
      );
    }
  }
  throw new TypeError("redisStorage requires a node-redis or ioredis client");
}

function redisCommandStorage(
  command: (args: (string | number)[]) => Promise<unknown>
): OAuthProxyStorage {
  const asString = (value: unknown): string | undefined =>
    typeof value === "string"
      ? value
      : value instanceof Uint8Array
        ? new TextDecoder().decode(value)
        : undefined;
  return {
    get: async (key) => asString(await command(["GET", key])),
    set: async (key, value, ttlSeconds) => {
      await command(["SET", key, value, "EX", ttlSeconds]);
    },
    delete: async (key) => {
      await command(["DEL", key]);
    },
    take: async (key) => asString(await command(["GETDEL", key])),
    add: async (key, value, ttlSeconds) =>
      (await command(["SET", key, value, "NX", "EX", ttlSeconds])) !== null,
  };
}

// ─── Postgres ────────────────────────────────────────────────────────────

/** A Postgres client: `pg`'s `Pool` or `Client`, or a compatible one. */
export interface PostgresLikeClient {
  /** Runs a parameterized query. */
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Options for {@link postgresStorage}. */
export interface PostgresStorageOptions {
  /** Postgres client, for example a `pg` `Pool`. */
  client: PostgresLikeClient;
  /**
   * Table name. The adapter creates the table on first use.
   *
   * @defaultValue `"mcp_use_oauth"`
   */
  table?: string;
}

/**
 * Creates a store in one Postgres table. Atomic reads-and-deletes use
 * `DELETE … RETURNING`; expired rows are removed in the background.
 *
 * @param options - Client and table name.
 * @returns A store for `oauthProxy`.
 */
export function postgresStorage(
  options: PostgresStorageOptions
): OAuthProxyStorage {
  const client = options?.client;
  if (client === null || typeof client?.query !== "function") {
    throw new TypeError("postgresStorage requires a client with query()");
  }
  const table = sqlIdentifier(options.table ?? "mcp_use_oauth");
  let ready: Promise<unknown> | undefined;
  const query = async (text: string, values: unknown[]) => {
    ready ??= client
      .query(
        `CREATE TABLE IF NOT EXISTS ${table} (key text PRIMARY KEY, value text NOT NULL, expires_at timestamptz NOT NULL)`
      )
      .catch((error: unknown) => {
        ready = undefined;
        throw error;
      });
    await ready;
    return client.query(text, values);
  };
  const sweep = () => {
    if (Math.random() < 0.01) {
      void query(`DELETE FROM ${table} WHERE expires_at <= now()`, []).catch(
        () => undefined
      );
    }
  };
  const upsert = `INSERT INTO ${table} (key, value, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3)) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`;
  return {
    get: async (key) => {
      const { rows } = await query(
        `SELECT value FROM ${table} WHERE key = $1 AND expires_at > now()`,
        [key]
      );
      return stringColumn(rows[0], "value");
    },
    set: async (key, value, ttlSeconds) => {
      await query(upsert, [key, value, ttlSeconds]);
      sweep();
    },
    delete: async (key) => {
      await query(`DELETE FROM ${table} WHERE key = $1`, [key]);
    },
    take: async (key) => {
      const { rows } = await query(
        `DELETE FROM ${table} WHERE key = $1 RETURNING value, expires_at > now() AS live`,
        [key]
      );
      return rows[0]?.["live"] === true
        ? stringColumn(rows[0], "value")
        : undefined;
    },
    add: async (key, value, ttlSeconds) => {
      const { rows } = await query(
        `${upsert} WHERE ${table}.expires_at <= now() RETURNING key`,
        [key, value, ttlSeconds]
      );
      sweep();
      return rows.length > 0;
    },
  };
}

// ─── Cloudflare (D1 or Durable Object) ───────────────────────────────────

/** The subset of a Cloudflare D1 database binding the adapter uses. */
export interface D1LikeDatabase {
  /** Prepares a statement. */
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

/** The subset of a Durable Object namespace binding the adapter uses. */
export interface DurableObjectNamespaceLike {
  /** Derives an object ID from a name. */
  idFromName(name: string): unknown;
  /** Gets a stub for an object ID. */
  get(id: never): {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
}

/** Options for {@link cloudflareStorage}: a D1 database or a Durable Object namespace. */
export type CloudflareStorageOptions =
  | {
      /** D1 database binding. The adapter creates its table on first use. */
      d1: D1LikeDatabase;
      /**
       * Table name.
       *
       * @defaultValue `"mcp_use_oauth"`
       */
      table?: string;
    }
  | {
      /**
       * Namespace binding of {@link OAuthProxyDurableObject}. Every key goes
       * to one object, whose single-threaded storage makes each operation
       * atomic.
       */
      durableObject: DurableObjectNamespaceLike;
    };

/**
 * Creates a store on Cloudflare: a D1 database or a Durable Object.
 * Workers KV alone is not suitable, because it has no atomic
 * read-and-delete, so two requests could spend one authorization code.
 *
 * @param options - A `d1` binding, or a `durableObject` namespace binding of
 * {@link OAuthProxyDurableObject}.
 * @returns A store for `oauthProxy`.
 */
export function cloudflareStorage(
  options: CloudflareStorageOptions
): OAuthProxyStorage {
  if (options !== null && typeof options === "object" && "d1" in options) {
    return d1Storage(
      options.d1,
      sqlIdentifier(options.table ?? "mcp_use_oauth")
    );
  }
  if (
    options !== null &&
    typeof options === "object" &&
    "durableObject" in options
  ) {
    const namespace = options.durableObject;
    const stub = namespace.get(namespace.idFromName("mcp-use-oauth") as never);
    const call = async (body: Record<string, unknown>): Promise<unknown> => {
      const response = await stub.fetch("https://oauth-storage/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          `OAuth storage Durable Object returned ${response.status}`
        );
      }
      return ((await response.json()) as { result?: unknown }).result;
    };
    return {
      get: async (key) =>
        (await call({ op: "get", key })) as string | undefined,
      set: async (key, value, ttlSeconds) => {
        await call({ op: "set", key, value, ttl: ttlSeconds });
      },
      delete: async (key) => {
        await call({ op: "delete", key });
      },
      take: async (key) =>
        (await call({ op: "take", key })) as string | undefined,
      add: async (key, value, ttlSeconds) =>
        (await call({ op: "add", key, value, ttl: ttlSeconds })) === true,
    };
  }
  throw new TypeError(
    "cloudflareStorage requires a d1 or durableObject binding"
  );
}

function d1Storage(db: D1LikeDatabase, table: string): OAuthProxyStorage {
  if (db === null || typeof db?.prepare !== "function") {
    throw new TypeError("cloudflareStorage d1 must be a D1 database binding");
  }
  let ready: Promise<unknown> | undefined;
  const statement = async (query: string, ...values: unknown[]) => {
    ready ??= db
      .prepare(
        `CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)`
      )
      .bind()
      .run()
      .catch((error: unknown) => {
        ready = undefined;
        throw error;
      });
    await ready;
    return db.prepare(query).bind(...values);
  };
  const now = () => Date.now();
  const upsert = `INSERT INTO ${table} (key, value, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`;
  const sweep = () => {
    if (Math.random() < 0.01) {
      void statement(`DELETE FROM ${table} WHERE expires_at <= ?1`, now())
        .then((query) => query.run())
        .catch(() => undefined);
    }
  };
  return {
    get: async (key) =>
      stringColumn(
        await (
          await statement(
            `SELECT value FROM ${table} WHERE key = ?1 AND expires_at > ?2`,
            key,
            now()
          )
        ).first(),
        "value"
      ),
    set: async (key, value, ttlSeconds) => {
      await (
        await statement(upsert, key, value, now() + ttlSeconds * 1000)
      ).run();
      sweep();
    },
    delete: async (key) => {
      await (await statement(`DELETE FROM ${table} WHERE key = ?1`, key)).run();
    },
    take: async (key) => {
      const row = await (
        await statement(
          `DELETE FROM ${table} WHERE key = ?1 RETURNING value, expires_at`,
          key
        )
      ).first();
      return row !== null && Number(row["expires_at"]) > now()
        ? stringColumn(row, "value")
        : undefined;
    },
    add: async (key, value, ttlSeconds) => {
      const row = await (
        await statement(
          `${upsert} WHERE ${table}.expires_at <= ?4 RETURNING key`,
          key,
          value,
          now() + ttlSeconds * 1000,
          now()
        )
      ).first();
      sweep();
      return row !== null;
    },
  };
}

/** The subset of Durable Object storage that {@link OAuthProxyDurableObject} uses. */
export interface DurableObjectStorageLike {
  /** Reads a value. */
  get<T>(key: string): Promise<T | undefined>;
  /** Writes a value. */
  put(key: string, value: unknown): Promise<void>;
  /** Removes a value. */
  delete(key: string): Promise<boolean>;
  /** Lists values. */
  list<T>(options?: { limit?: number }): Promise<Map<string, T>>;
}

/**
 * Durable Object class for {@link cloudflareStorage}. Export it from the
 * Worker and bind it in `wrangler.jsonc`:
 *
 * ```ts
 * export { OAuthProxyDurableObject } from "mcp-use/oauth/storage";
 * // wrangler: durable_objects.bindings = [{ name: "OAUTH", class_name: "OAuthProxyDurableObject" }]
 * // plus a migration with new_sqlite_classes = ["OAuthProxyDurableObject"]
 * ```
 */
export class OAuthProxyDurableObject {
  readonly #storage: DurableObjectStorageLike;
  #writes = 0;

  /**
   * Called by the Workers runtime.
   *
   * @param state - Durable Object state with its storage.
   * @param _env - Worker environment (unused).
   */
  constructor(state: { storage: DurableObjectStorageLike }, _env?: unknown) {
    this.#storage = state.storage;
  }

  /**
   * Handles one storage operation from {@link cloudflareStorage}.
   *
   * @param request - JSON body with the operation.
   * @returns JSON body with the result.
   */
  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      op?: string;
      key?: string;
      value?: string;
      ttl?: number;
    };
    if (typeof body.key !== "string") {
      return new Response("key required", { status: 400 });
    }
    const key = body.key;
    const read = async (): Promise<string | undefined> => {
      const entry = await this.#storage.get<{
        value: string;
        expiresAt: number;
      }>(key);
      if (entry === undefined) return undefined;
      if (entry.expiresAt <= Date.now()) {
        await this.#storage.delete(key);
        return undefined;
      }
      return entry.value;
    };
    const write = async (): Promise<void> => {
      await this.#storage.put(key, {
        value: String(body.value),
        expiresAt: Date.now() + Number(body.ttl) * 1000,
      });
      if (++this.#writes % 200 === 0) await this.#sweep();
    };
    let result: unknown;
    switch (body.op) {
      case "get":
        result = await read();
        break;
      case "set":
        await write();
        break;
      case "delete":
        await this.#storage.delete(key);
        break;
      case "take":
        result = await read();
        await this.#storage.delete(key);
        break;
      case "add":
        result = (await read()) === undefined;
        if (result === true) await write();
        break;
      default:
        return new Response("unknown op", { status: 400 });
    }
    return Response.json({ result });
  }

  async #sweep(): Promise<void> {
    const entries = await this.#storage.list<{ expiresAt: number }>({
      limit: 1000,
    });
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) await this.#storage.delete(key);
    }
  }
}

function sqlIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new TypeError(
      "OAuth storage table name must be a plain SQL identifier"
    );
  }
  return name;
}

function stringColumn(
  row: Record<string, unknown> | null | undefined,
  column: string
): string | undefined {
  const value = row?.[column];
  return typeof value === "string" ? value : undefined;
}
