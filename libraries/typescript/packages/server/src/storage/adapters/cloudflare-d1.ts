/**
 * Cloudflare storage: `cloudflareStorage()` over a D1 database or a Durable
 * Object namespace, and the D1 adapter itself.
 *
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "../../oauth/proxy/storage.js";
import { applyStoragePrefix, validateStoragePrefix } from "../prefix.js";
import { createSqlStorage, type SqlExecutor } from "../sql/engine.js";
import type { McpUseStorage } from "../types.js";
import {
  durableObjectStorage,
  type DurableObjectNamespaceLike,
} from "./cloudflare-do.js";
import { sqlIdentifier, stringColumn } from "./postgres.js";

/** A bound D1 statement. */
export interface D1LikeBoundStatement {
  /** Runs the statement and returns its first row, or `null`. */
  first<T = Record<string, unknown>>(): Promise<T | null>;
  /** Runs the statement without returning rows. */
  run(): Promise<unknown>;
  /**
   * Runs the statement and returns all rows. Every real D1 binding has it;
   * the Events primitives need it.
   */
  all?<T = Record<string, unknown>>(): Promise<{
    /** Result rows. */
    results?: T[];
  }>;
}

/** The subset of a Cloudflare D1 database binding the adapter uses. */
export interface D1LikeDatabase {
  /** Prepares a statement. */
  prepare(query: string): {
    /** Binds the statement's `?1`, `?2`, … parameters. */
    bind(...values: unknown[]): D1LikeBoundStatement;
  };
  /**
   * Runs bound statements in one transaction. Every real D1 binding has
   * it; the Events primitives need it (each `logAppend` is one batch).
   */
  batch?(statements: D1LikeBoundStatement[]): Promise<
    Array<{
      /** Result rows of the statement. */
      results?: Record<string, unknown>[];
    }>
  >;
}

/** Options for {@link cloudflareStorage}: a D1 database or a Durable Object namespace. */
export type CloudflareStorageOptions =
  | {
      /**
       * D1 database binding. OAuth state uses `table`; Events state uses
       * the tables `mcp_use_kv`, `mcp_use_index`, `mcp_use_log_head` and
       * `mcp_use_log`, created together on first use.
       */
      d1: D1LikeDatabase;
      /**
       * OAuth table name; an existing table is never altered.
       *
       * @defaultValue `"mcp_use_oauth"`
       */
      table?: string;
      /**
       * Prepended to every key the store writes. Must not contain `{` or `}`.
       *
       * @defaultValue `""`
       */
      prefix?: string;
    }
  | {
      /**
       * Namespace binding of `McpUseStorageDurableObject` (OAuth and
       * Events) or of `OAuthProxyDurableObject` (OAuth only). OAuth keys go
       * to one object and Events state to another, whose
       * single-threaded storage makes each operation atomic.
       */
      durableObject: DurableObjectNamespaceLike;
      /**
       * Prepended to every key the store writes. Must not contain `{` or `}`.
       *
       * @defaultValue `""`
       */
      prefix?: string;
    };

/**
 * Creates a store on Cloudflare: a D1 database or a Durable Object.
 * Workers KV alone is not suitable, because it has no atomic
 * read-and-delete or compare-and-set, so two requests could spend one
 * authorization code.
 *
 * @param options - A `d1` binding, or a `durableObject` namespace binding of
 * `McpUseStorageDurableObject`, and a key prefix.
 * @returns A store for `oauthProxy` and Events.
 */
export function cloudflareStorage(
  options: CloudflareStorageOptions
): McpUseStorage {
  if (options !== null && typeof options === "object" && "d1" in options) {
    const prefix = validateStoragePrefix(options.prefix, "cloudflareStorage");
    const db = options.d1;
    const oauth = d1Storage(
      db,
      sqlIdentifier(options.table ?? "mcp_use_oauth")
    );
    return applyStoragePrefix(
      createSqlStorage(d1Executor(db), { kind: "d1", qualifier: "", oauth }),
      prefix
    );
  }
  if (
    options !== null &&
    typeof options === "object" &&
    "durableObject" in options
  ) {
    const prefix = validateStoragePrefix(options.prefix, "cloudflareStorage");
    return applyStoragePrefix(
      durableObjectStorage(options.durableObject),
      prefix
    );
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

function d1Executor(db: D1LikeDatabase): SqlExecutor {
  const bind = (text: string, values: unknown[]) =>
    db.prepare(text).bind(...values);
  const missing = (what: string) =>
    new TypeError(
      `cloudflareStorage d1 binding has no ${what}(); pass the D1 database binding from env`
    );
  return {
    dialect: "sqlite",
    query: async ({ text, values }) => {
      const statement = bind(text, values);
      if (typeof statement.all !== "function") throw missing("all");
      return (await statement.all()).results ?? [];
    },
    atomic: async (statements) => {
      if (typeof db.batch !== "function") throw missing("batch");
      const results = await db.batch(
        statements.map(({ text, values }) => bind(text, values))
      );
      return results.map((result) => result.results ?? []);
    },
  };
}
