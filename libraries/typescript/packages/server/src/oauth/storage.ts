/**
 * Storage adapters for the OAuth proxy (`oauthProxy` in `mcp-use/oauth`).
 *
 * Each adapter takes a client or binding that the application already has,
 * so this package adds no database dependency. The proxy encrypts every
 * value before an adapter sees it.
 *
 * @packageDocumentation
 */
import { isBuilding } from "../build-phase.js";
import { isRecord } from "./guards.js";
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
 * so it runs on Node, Vercel, and Cloudflare Workers alike. Inside
 * `mcp-use build` (see `isBuilding()` in `mcp-use`), the URL and token may be
 * missing.
 *
 * @param options - REST URL and token of the database.
 * @returns A store for `oauthProxy`.
 */
export function upstashStorage(
  options: UpstashStorageOptions
): OAuthProxyStorage {
  // `mcp-use build` runs the entry without serving requests, so it needs no
  // credentials. Outside a build, a missing URL or token fails here.
  if (
    (typeof options?.url !== "string" || typeof options.token !== "string") &&
    !isBuilding()
  ) {
    throw new TypeError("upstashStorage requires url and token");
  }
  const url = String(options?.url).replace(/\/+$/, "");
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
 * Creates a store on Redis (6.2 or later) through a node-redis or ioredis
 * client.
 *
 * Pass a connected client, or a function that connects one. The function
 * runs on the first storage call, which keeps importing the server free of
 * network calls: `mcp-use build` and serverless cold starts do not wait on
 * Redis. Concurrent first calls share one connection attempt, and a failed
 * attempt is retried on the next call. With a function, a wrong URL shows up
 * at the first sign-in rather than at startup.
 *
 * @param client - A connected node-redis or ioredis client, or a function
 * that returns one or a promise of one.
 * @returns A store for `oauthProxy`.
 *
 * @example
 * ```ts
 * import { createClient } from "redis";
 * import { redisStorage } from "mcp-use/oauth/storage";
 *
 * const storage = redisStorage(() =>
 *   createClient({ url: process.env.REDIS_URL })
 *     .on("error", (error) => console.error("Redis error:", error))
 *     .connect()
 * );
 * ```
 */
export function redisStorage(
  client:
    | RedisLikeClient
    | (() => RedisLikeClient | PromiseLike<RedisLikeClient>)
): OAuthProxyStorage {
  if (typeof client !== "function") {
    const command = redisCommand(client);
    return redisCommandStorage(command);
  }
  let connecting: Promise<RedisCommand> | undefined;
  const connect = (): Promise<RedisCommand> => {
    connecting ??= Promise.resolve()
      .then(client)
      .then(redisCommand)
      .catch((error: unknown) => {
        connecting = undefined;
        throw error;
      });
    return connecting;
  };
  return redisCommandStorage(async (args) => (await connect())(args));
}

/** A node-redis or ioredis client accepted by {@link redisStorage}. */
export type RedisLikeClient = NodeRedisLikeClient | IORedisLikeClient;

type RedisCommand = (args: (string | number)[]) => Promise<unknown>;

function redisCommand(client: RedisLikeClient): RedisCommand {
  if (client !== null && typeof client === "object") {
    if (typeof (client as NodeRedisLikeClient).sendCommand === "function") {
      const redis = client as NodeRedisLikeClient;
      return (args) => redis.sendCommand(args.map(String));
    }
    if (typeof (client as IORedisLikeClient).call === "function") {
      const redis = client as IORedisLikeClient;
      return ([name, ...args]) => redis.call(String(name), ...args.map(String));
    }
  }
  throw new TypeError("redisStorage requires a node-redis or ioredis client");
}

function redisCommandStorage(command: RedisCommand): OAuthProxyStorage {
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

// ─── Firestore ───────────────────────────────────────────────────────────

/** The subset of a Firestore document snapshot the adapter uses. */
export interface FirestoreLikeDocumentSnapshot {
  /** Whether the document exists. */
  readonly exists: boolean;
  /** The document's fields, or `undefined` when it does not exist. */
  data(): Record<string, unknown> | undefined;
}

/** The subset of a Firestore document reference the adapter uses. */
export interface FirestoreLikeDocumentReference {
  /** Reads the document. */
  get(): Promise<FirestoreLikeDocumentSnapshot>;
  /** Writes the document, replacing it. */
  set(data: Record<string, unknown>): Promise<unknown>;
  /** Deletes the document. Deleting an absent document is not an error. */
  delete(): Promise<unknown>;
}

/** The subset of a Firestore transaction the adapter uses. */
export interface FirestoreLikeTransaction {
  /** Reads a document inside the transaction. */
  get(
    reference: FirestoreLikeDocumentReference
  ): Promise<FirestoreLikeDocumentSnapshot>;
  /** Writes a document when the transaction commits. */
  set(
    reference: FirestoreLikeDocumentReference,
    data: Record<string, unknown>
  ): unknown;
  /** Deletes a document when the transaction commits. */
  delete(reference: FirestoreLikeDocumentReference): unknown;
}

/**
 * A server-side Firestore database: the `Firestore` instance of
 * `@google-cloud/firestore`, or `getFirestore()` of `firebase-admin`.
 */
export interface FirestoreLikeDatabase {
  /** Gets a collection. */
  collection(path: string): {
    doc(id: string): FirestoreLikeDocumentReference;
  };
  /** Runs a function in a transaction, retrying it on contention. */
  runTransaction<T>(
    update: (transaction: FirestoreLikeTransaction) => Promise<T>
  ): Promise<T>;
}

/** Options for {@link firestoreStorage}. */
export interface FirestoreStorageOptions {
  /** Firestore database, for example `getFirestore()` from `firebase-admin/firestore`. */
  firestore: FirestoreLikeDatabase;
  /**
   * Collection that holds one document per key.
   *
   * @defaultValue `"mcp_use_oauth"`
   */
  collection?: string;
}

/**
 * Creates a store in one Firestore collection, with the server SDK
 * (`firebase-admin` or `@google-cloud/firestore`). Atomic reads-and-deletes
 * and writes-if-absent run in transactions.
 *
 * Each document holds `value` and an `expiresAt` timestamp. The adapter
 * ignores expired documents, but Firestore keeps them until they are
 * deleted: add a TTL policy on the `expiresAt` field of the collection so
 * that Firestore removes them.
 *
 * The server SDK needs Node; it does not run on Cloudflare Workers or other
 * edge runtimes.
 *
 * @param options - Firestore database and collection name.
 * @returns A store for `oauthProxy`.
 *
 * @example
 * ```ts
 * import { initializeApp } from "firebase-admin/app";
 * import { getFirestore } from "firebase-admin/firestore";
 * import { firestoreStorage } from "mcp-use/oauth/storage";
 *
 * initializeApp();
 * const storage = firestoreStorage({ firestore: getFirestore() });
 * ```
 */
export function firestoreStorage(
  options: FirestoreStorageOptions
): OAuthProxyStorage {
  const firestore = options?.firestore;
  if (
    firestore === null ||
    typeof firestore?.collection !== "function" ||
    typeof firestore.runTransaction !== "function"
  ) {
    throw new TypeError(
      "firestoreStorage requires a Firestore database from firebase-admin or @google-cloud/firestore"
    );
  }
  const name = options.collection ?? "mcp_use_oauth";
  if (
    typeof name !== "string" ||
    !/^[^/]{1,1500}$/.test(name) ||
    /^__.*__$/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new TypeError(
      "firestoreStorage collection must be a collection ID without slashes"
    );
  }
  const collection = firestore.collection(name);
  // Keys can hold any character, and a document ID cannot hold "/".
  const document = (key: string) => collection.doc(encodeURIComponent(key));
  const live = (
    snapshot: FirestoreLikeDocumentSnapshot
  ): string | undefined => {
    if (!snapshot.exists) return undefined;
    const data = snapshot.data();
    const value = data?.["value"];
    return typeof value === "string" && expiresAtMillis(data) > Date.now()
      ? value
      : undefined;
  };
  const record = (value: string, ttlSeconds: number) => ({
    value,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
  return {
    get: async (key) => live(await document(key).get()),
    set: async (key, value, ttlSeconds) => {
      await document(key).set(record(value, ttlSeconds));
    },
    delete: async (key) => {
      await document(key).delete();
    },
    take: (key) =>
      firestore.runTransaction(async (transaction) => {
        const reference = document(key);
        const snapshot = await transaction.get(reference);
        if (snapshot.exists) transaction.delete(reference);
        return live(snapshot);
      }),
    add: (key, value, ttlSeconds) =>
      firestore.runTransaction(async (transaction) => {
        const reference = document(key);
        if (live(await transaction.get(reference)) !== undefined) return false;
        transaction.set(reference, record(value, ttlSeconds));
        return true;
      }),
  };
}

/** Reads `expiresAt`, a Firestore `Timestamp` or a `Date`, as milliseconds. */
function expiresAtMillis(data: Record<string, unknown> | undefined): number {
  const expiresAt = data?.["expiresAt"];
  if (expiresAt instanceof Date) return expiresAt.getTime();
  if (isRecord(expiresAt) && typeof expiresAt["toMillis"] === "function") {
    const millis: unknown = (expiresAt["toMillis"] as () => unknown).call(
      expiresAt
    );
    return typeof millis === "number" ? millis : 0;
  }
  return 0;
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
  /**
   * Lists values in key order.
   *
   * @param options - `limit` caps how many entries come back; `startAfter`
   * lists only keys that sort after this key.
   */
  list<T>(options?: {
    limit?: number;
    startAfter?: string;
  }): Promise<Map<string, T>>;
}

// Where OAuthProxyDurableObject keeps its sweep position: outside the
// `mcp-use:oauth:` keys that oauthProxy stores.
const SWEEP_CURSOR_KEY = "mcp-use-sweep-cursor";

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

  // Each sweep checks the next page of keys, so expired entries behind
  // 1,000 live ones are reached too. The position is stored, so it survives
  // the object being evicted between sweeps.
  async #sweep(): Promise<void> {
    const limit = 1000;
    const cursor = await this.#storage.get<string>(SWEEP_CURSOR_KEY);
    const entries = await this.#storage.list<{ expiresAt: number }>({
      limit,
      ...(cursor !== undefined && { startAfter: cursor }),
    });
    const now = Date.now();
    let last: string | undefined;
    for (const [key, entry] of entries) {
      last = key;
      if (key === SWEEP_CURSOR_KEY) continue;
      if (entry.expiresAt <= now) await this.#storage.delete(key);
    }
    if (entries.size < limit || last === undefined) {
      await this.#storage.delete(SWEEP_CURSOR_KEY);
    } else {
      await this.#storage.put(SWEEP_CURSOR_KEY, last);
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
