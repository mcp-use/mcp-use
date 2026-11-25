/**
 * Postgres storage through a `pg`-compatible client or pool.
 *
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "../../oauth/proxy/storage.js";
import { applyStoragePrefix, validateStoragePrefix } from "../prefix.js";
import {
  createSqlStorage,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "../sql/engine.js";
import type { McpUseStorage, StorageSignal } from "../types.js";

/** A Postgres client: `pg`'s `Pool` or `Client`, or a compatible one. */
export interface PostgresLikeClient {
  /** Runs a parameterized query. */
  query(
    text: string,
    values?: unknown[]
  ): Promise<{
    /** Result rows, one object per row keyed by column name. */
    rows: Record<string, unknown>[];
  }>;
  /**
   * Checks out a dedicated connection (`pg.Pool`, recognised by its
   * `totalCount`). For a pool, multi-step
   * operations run in a transaction on their own connection and `LISTEN`
   * uses one connection for the signal. Without it (one `Client`),
   * operations are serialized on the one connection and `signal` is off.
   */
  connect?(): Promise<PostgresPoolClientLike>;
}

/** A connection checked out of a pool (`pg.PoolClient`). */
export interface PostgresPoolClientLike {
  /** Runs a parameterized query. */
  query(
    text: string,
    values?: unknown[]
  ): Promise<{
    /** Result rows, one object per row keyed by column name. */
    rows: Record<string, unknown>[];
  }>;
  /** Returns the connection to the pool; pass an error or `true` to discard it. */
  release(error?: Error | boolean): void;
  /** Adds a `notification` (from `LISTEN`) or `error` listener. */
  on?(event: string, listener: (...args: never[]) => void): unknown;
  /** Removes a listener added with `on`. */
  off?(event: string, listener: (...args: never[]) => void): unknown;
}

/** Options for {@link postgresStorage}. */
export interface PostgresStorageOptions {
  /** Postgres client, for example a `pg` `Pool`. */
  client?: PostgresLikeClient;
  /** Same as `client`, for a `pg` `Pool`. */
  pool?: PostgresLikeClient;
  /**
   * OAuth table name. The adapter creates the table on first OAuth use and
   * never changes an existing one.
   *
   * @defaultValue `"mcp_use_oauth"`
   */
  table?: string;
  /**
   * Schema of the Events tables `mcp_use_kv`, `mcp_use_index`,
   * `mcp_use_log_head` and `mcp_use_log`, which are created together on
   * first use. Omitted uses the connection's `search_path`.
   */
  schema?: string;
  /**
   * Wake signal over `LISTEN`/`NOTIFY`, on one dedicated connection from
   * the pool. Set `false` behind PgBouncer in transaction mode or with a
   * serverless driver whose connections cannot `LISTEN`; readers then poll
   * the log. Always off for a client without `connect()`.
   *
   * @defaultValue `true`
   */
  signal?: boolean;
  /**
   * Prepended to every key the store writes. Must not contain `{` or `}`.
   *
   * @defaultValue `""`
   */
  prefix?: string;
}

const NOTIFY_CHANNEL = "mcp_use_signal";

/**
 * Creates a store on Postgres. OAuth state stays in its own table
 * (`mcp_use_oauth` by default, never altered); Events state lives in four
 * tables created lazily together, which needs the `CREATE TABLE`
 * permission on first use. Every `logAppend` is one transaction.
 *
 * @param options - Client or pool, OAuth table, schema, signal and key prefix.
 * @returns A store for `oauthProxy` and Events.
 *
 * @example
 * ```ts
 * import pg from "pg";
 * const storage = postgresStorage({ pool: new pg.Pool({ connectionString }) });
 * ```
 */
export function postgresStorage(
  options: PostgresStorageOptions
): McpUseStorage {
  const client = options?.client ?? options?.pool;
  if (
    client === null ||
    client === undefined ||
    typeof client.query !== "function"
  ) {
    throw new TypeError("postgresStorage requires a client with query()");
  }
  const prefix = validateStoragePrefix(options.prefix, "postgresStorage");
  const table = sqlIdentifier(options.table ?? "mcp_use_oauth");
  const qualifier =
    options.schema === undefined ? "" : `${sqlIdentifier(options.schema)}.`;
  // pg.Client also has connect() (it opens itself); a pool counts clients.
  const pooled =
    typeof client.connect === "function" &&
    typeof (client as { totalCount?: unknown }).totalCount === "number";
  const exec = pooled ? poolExecutor(client) : serialExecutor(client);
  const signal =
    pooled && options.signal !== false ? listenSignal(client) : undefined;
  const storage = createSqlStorage(exec, {
    kind: "postgres",
    qualifier,
    oauth: postgresOAuthStorage(
      pooled
        ? client
        : {
            query: (text, values) =>
              serialOf(client)(() => client.query(text, values)),
          },
      table
    ),
    ...(signal && {
      signal,
      notifySql: (payload: string) =>
        `SELECT pg_notify('${NOTIFY_CHANNEL}', ${payload})`,
    }),
  });
  return applyStoragePrefix(storage, prefix);
}

const run = async (
  conn: Pick<PostgresLikeClient, "query">,
  statement: SqlStatement
) => (await conn.query(statement.text, statement.values)).rows;

async function transaction(
  conn: Pick<PostgresLikeClient, "query">,
  statements: SqlStatement[]
): Promise<SqlRow[][]> {
  await conn.query("BEGIN");
  try {
    const results: SqlRow[][] = [];
    for (const statement of statements) {
      results.push(await run(conn, statement));
    }
    await conn.query("COMMIT");
    return results;
  } catch (error) {
    await conn.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function poolExecutor(pool: PostgresLikeClient): SqlExecutor {
  return {
    dialect: "postgres",
    query: (statement) => run(pool, statement),
    atomic: async (statements) => {
      const conn = await pool.connect!();
      let failed = false;
      try {
        return await transaction(conn, statements);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        // A failed transaction may leave the connection unusable.
        conn.release(failed);
      }
    },
  };
}

// One connection: a transaction must not interleave with other statements,
// including those of other stores and of the OAuth table on that client.
const serialQueues = new WeakMap<
  object,
  <T>(task: () => Promise<T>) => Promise<T>
>();

function serialOf(conn: PostgresLikeClient) {
  let serial = serialQueues.get(conn);
  if (!serial) {
    let tail: Promise<unknown> = Promise.resolve();
    serial = <T>(task: () => Promise<T>): Promise<T> => {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    };
    serialQueues.set(conn, serial);
  }
  return serial;
}

function serialExecutor(conn: PostgresLikeClient): SqlExecutor {
  const serial = serialOf(conn);
  return {
    dialect: "postgres",
    query: (statement) => serial(() => run(conn, statement)),
    atomic: (statements) => serial(() => transaction(conn, statements)),
  };
}

/**
 * `NOTIFY` on one fixed channel whose payload is `"<channel>\n<message>"`;
 * one pooled connection runs `LISTEN` while anyone is subscribed.
 */
function listenSignal(pool: PostgresLikeClient): StorageSignal {
  const listeners = new Map<string, Set<(message: string) => void>>();
  let connection: Promise<PostgresPoolClientLike> | undefined;
  const onNotification = (msg: { channel?: string; payload?: string }) => {
    if (msg.channel !== NOTIFY_CHANNEL || typeof msg.payload !== "string") {
      return;
    }
    const split = msg.payload.indexOf("\n");
    if (split === -1) return;
    const channel = msg.payload.slice(0, split);
    const message = msg.payload.slice(split + 1);
    for (const listener of listeners.get(channel) ?? []) {
      try {
        listener(message);
      } catch {
        // One listener's failure must not stop the others.
      }
    }
  };
  const detach = (conn: PostgresPoolClientLike) => {
    conn.off?.("notification", onNotification as never);
    conn.off?.("error", onError as never);
  };
  // A broken LISTEN connection is discarded; the next subscribe reopens one.
  function onError(): void {
    const current = connection;
    connection = undefined;
    void current
      ?.then((conn) => {
        detach(conn);
        conn.release(true);
      })
      .catch(() => undefined);
  }
  const open = () => {
    connection ??= (async () => {
      const conn = await pool.connect!();
      if (typeof conn.on !== "function") {
        conn.release();
        throw new TypeError(
          "postgresStorage signal needs a connection with on('notification'); pass signal: false"
        );
      }
      conn.on("notification", onNotification as never);
      conn.on("error", onError as never);
      try {
        await conn.query(`LISTEN ${NOTIFY_CHANNEL}`);
      } catch (error) {
        detach(conn);
        conn.release(true);
        throw error;
      }
      return conn;
    })();
    connection.catch(() => {
      connection = undefined;
    });
    return connection;
  };
  return {
    publish: async (channel, message) => {
      await pool.query("SELECT pg_notify($1, $2)", [
        NOTIFY_CHANNEL,
        `${channel}\n${message}`,
      ]);
    },
    subscribe: async (channel, onMessage) => {
      const set = listeners.get(channel) ?? new Set();
      listeners.set(channel, set);
      set.add(onMessage);
      try {
        await open();
      } catch (error) {
        set.delete(onMessage);
        if (set.size === 0) listeners.delete(channel);
        throw error;
      }
      return async () => {
        set.delete(onMessage);
        if (set.size === 0 && listeners.get(channel) === set) {
          listeners.delete(channel);
        }
        if (listeners.size === 0 && connection) {
          const current = connection;
          connection = undefined;
          const conn = await current.catch(() => undefined);
          if (conn) {
            await conn
              .query(`UNLISTEN ${NOTIFY_CHANNEL}`)
              .catch(() => undefined);
            detach(conn);
            conn.release();
          }
        }
      };
    },
  };
}

/** @internal The OAuth key-value operations on their own table, unchanged. */
export function postgresOAuthStorage(
  client: PostgresLikeClient,
  table: string
): OAuthProxyStorage {
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

/** @internal Checks that a table or schema name is a plain SQL identifier. */
export function sqlIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new TypeError(
      "OAuth storage table name must be a plain SQL identifier"
    );
  }
  return name;
}

/** @internal Reads a string column of a result row. */
export function stringColumn(
  row: Record<string, unknown> | null | undefined,
  column: string
): string | undefined {
  const value = row?.[column];
  return typeof value === "string" ? value : undefined;
}
