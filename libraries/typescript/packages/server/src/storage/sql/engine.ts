/**
 * The SQL half of `postgresStorage` and `cloudflareStorage({ d1 })`: the
 * `McpUseStorage` primitives over four tables, `mcp_use_kv`,
 * `mcp_use_index`, `mcp_use_log_head` and `mcp_use_log`, created lazily
 * together on first use. The OAuth table `mcp_use_oauth` is never touched
 * here.
 *
 * Statements are written once with `:name` parameters and compiled to `$n`
 * (Postgres) or `?n` (SQLite/D1). Multi-statement operations run through
 * {@link SqlExecutor.atomic}: one transaction on Postgres, one `batch()` on
 * D1, so no failure can stop `logAppend` between steps.
 *
 * @internal
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "../../oauth/proxy/storage.js";
import type {
  IndexEntry,
  LogAppendResult,
  McpUseStorage,
  StorageSignal,
  Versioned,
} from "../types.js";

/** @internal One compiled statement. */
export interface SqlStatement {
  /** SQL text with dialect placeholders. */
  text: string;
  /** Positional parameters. */
  values: unknown[];
}

/** @internal A result row keyed by column name. */
export type SqlRow = Record<string, unknown>;

/** @internal A database connection the engine runs statements on. */
export interface SqlExecutor {
  /** Placeholder and type dialect. */
  dialect: "postgres" | "sqlite";
  /** Runs one statement and returns its rows. */
  query(statement: SqlStatement): Promise<SqlRow[]>;
  /**
   * Runs statements all-or-nothing, in order, isolated from concurrent
   * writers of the same rows. Returns the rows of each statement.
   */
  atomic(statements: SqlStatement[]): Promise<SqlRow[][]>;
}

/** @internal Options for {@link createSqlStorage}. */
export interface SqlStorageOptions {
  /** Adapter name reported as `kind`. */
  kind: string;
  /** Table name qualifier, for example `"my_schema."`, or `""`. */
  qualifier: string;
  /** OAuth methods, kept on their own table. */
  oauth: OAuthProxyStorage;
  /** Wake signal, when the database supports one. */
  signal?: StorageSignal;
  /**
   * Builds the statement that publishes `payload` inside the append
   * transaction (Postgres `pg_notify`). Its SQL must select from the head
   * row filtered by `cond`.
   */
  notifySql?: (payloadSql: string) => string;
}

const SAFE_INT_LIMIT = 2 ** 52;

function newVersion(): number {
  return 1 + Math.floor(Math.random() * SAFE_INT_LIMIT);
}

function newEpoch(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @internal Compiles `:name` parameters to dialect placeholders. A name used
 * twice binds one parameter.
 */
export function compileSql(
  dialect: SqlExecutor["dialect"],
  text: string,
  params: Record<string, unknown> = {}
): SqlStatement {
  const order: string[] = [];
  const compiled = text.replace(/:([a-z][a-z0-9_]*)/gi, (_, name: string) => {
    if (!(name in params)) {
      throw new TypeError(`SQL parameter :${name} is not bound`);
    }
    let index = order.indexOf(name);
    if (index === -1) index = order.push(name) - 1;
    return dialect === "postgres" ? `$${index + 1}` : `?${index + 1}`;
  });
  return { text: compiled, values: order.map((name) => params[name]) };
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function str(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

/**
 * @internal Builds the `McpUseStorage` primitives on a SQL executor.
 *
 * @param exec - Database connection.
 * @param options - Kind, table qualifier, OAuth methods and signal.
 * @returns A store; wrap it with `applyStoragePrefix` for a prefix.
 */
export function createSqlStorage(
  exec: SqlExecutor,
  options: SqlStorageOptions
): McpUseStorage {
  const q = options.qualifier;
  const KV = `${q}mcp_use_kv`;
  const IX = `${q}mcp_use_index`;
  const HEAD = `${q}mcp_use_log_head`;
  const LOG = `${q}mcp_use_log`;
  const sql = (text: string, params?: Record<string, unknown>) =>
    compileSql(exec.dialect, text, params);
  const live = (alias: string) =>
    `(${alias}.expires_at IS NULL OR ${alias}.expires_at > :now)`;

  const ddl = [
    `CREATE TABLE IF NOT EXISTS ${KV} (key TEXT PRIMARY KEY, value TEXT NOT NULL, version BIGINT NOT NULL, expires_at BIGINT)`,
    `CREATE TABLE IF NOT EXISTS ${IX} (idx TEXT NOT NULL, member TEXT NOT NULL, score DOUBLE PRECISION NOT NULL, PRIMARY KEY (idx, member))`,
    `CREATE INDEX IF NOT EXISTS mcp_use_index_score ON ${IX} (idx, score, member)`,
    `CREATE TABLE IF NOT EXISTS ${HEAD} (stream TEXT PRIMARY KEY, epoch TEXT NOT NULL, seq BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ${LOG} (stream TEXT NOT NULL, seq BIGINT NOT NULL, value TEXT NOT NULL, at BIGINT NOT NULL, expires_at BIGINT, PRIMARY KEY (stream, seq))`,
  ];
  let ready: Promise<unknown> | undefined;
  const ensure = () => {
    ready ??= exec
      .atomic(
        [
          // Concurrent CREATE TABLE IF NOT EXISTS can collide on Postgres.
          ...(exec.dialect === "postgres"
            ? ["SELECT pg_advisory_xact_lock(7266756173100288)"]
            : []),
          ...ddl,
        ].map((text) => ({ text, values: [] }))
      )
      .catch((error: unknown) => {
        ready = undefined;
        throw error;
      });
    return ready;
  };
  const query = async (statement: SqlStatement) => {
    await ensure();
    return exec.query(statement);
  };
  const atomic = async (statements: SqlStatement[]) => {
    await ensure();
    return exec.atomic(statements);
  };
  const sweep = () => {
    if (Math.random() < 0.01) {
      void query(
        sql(
          `DELETE FROM ${KV} WHERE expires_at IS NOT NULL AND expires_at <= :now`,
          { now: Date.now() }
        )
      ).catch(() => undefined);
    }
  };

  const read = async (key: string): Promise<Versioned | undefined> => {
    const rows = await query(
      sql(
        `SELECT value, version FROM ${KV} t WHERE key = :key AND ${live("t")}`,
        {
          key,
          now: Date.now(),
        }
      )
    );
    const row = rows[0];
    return row
      ? { value: String(row["value"]), version: String(row["version"]) }
      : undefined;
  };

  const upsert = `INSERT INTO ${KV} AS t (key, value, version, expires_at) VALUES (:key, :value, :version, :exp) ON CONFLICT (key) DO UPDATE SET value = excluded.value, version = excluded.version, expires_at = excluded.expires_at`;

  const write: McpUseStorage["write"] = async (key, value, opts = {}) => {
    const version = newVersion();
    const params = {
      key,
      value,
      version,
      exp: opts.ttlMs === undefined ? null : Date.now() + opts.ttlMs,
      now: Date.now(),
    };
    let rows: SqlRow[];
    if (opts.ifVersion === undefined) {
      rows = await query(sql(`${upsert} RETURNING version`, params));
    } else if (opts.ifVersion === null) {
      rows = await query(
        sql(`${upsert} WHERE NOT ${live("t")} RETURNING version`, params)
      );
    } else {
      if (!/^\d{1,20}$/.test(opts.ifVersion)) return false;
      rows = await query(
        sql(
          `UPDATE ${KV} AS t SET value = :value, version = :version, expires_at = :exp WHERE key = :key AND version = CAST(:expected AS BIGINT) AND ${live("t")} RETURNING version`,
          { ...params, expected: opts.ifVersion }
        )
      );
    }
    if (opts.ttlMs !== undefined) sweep();
    return rows.length > 0 ? String(version) : false;
  };

  const remove: McpUseStorage["remove"] = async (key, opts) => {
    const conditional = opts?.ifVersion !== undefined;
    if (conditional && !/^\d{1,20}$/.test(opts.ifVersion!)) return false;
    const rows = await query(
      sql(
        `DELETE FROM ${KV} AS t WHERE key = :key AND ${live("t")}${conditional ? " AND version = CAST(:expected AS BIGINT)" : ""} RETURNING key`,
        {
          key,
          now: Date.now(),
          ...(conditional && { expected: opts!.ifVersion }),
        }
      )
    );
    return rows.length > 0;
  };

  const rangeWhere = (
    query: { min?: number; max?: number },
    params: Record<string, unknown>
  ) => {
    let where = "";
    if (query.min !== undefined) {
      where += " AND score >= :min";
      params["min"] = query.min;
    }
    if (query.max !== undefined) {
      where += " AND score <= :max";
      params["max"] = query.max;
    }
    return where;
  };

  const storage: McpUseStorage = {
    kind: options.kind,
    durable: true,
    shared: true,
    capabilities: { signal: options.signal !== undefined, batch: false },
    get: (key) => options.oauth.get(key),
    set: (key, value, ttlSeconds) => options.oauth.set(key, value, ttlSeconds),
    delete: (key) => options.oauth.delete(key),
    take: (key) => options.oauth.take(key),
    add: (key, value, ttlSeconds) => options.oauth.add(key, value, ttlSeconds),

    read,
    readMany: async (keys) => {
      if (keys.length === 0) return [];
      const params: Record<string, unknown> = { now: Date.now() };
      const names = keys.map((key, i) => {
        params[`k${i}`] = key;
        return `:k${i}`;
      });
      const rows = await query(
        sql(
          `SELECT key, value, version FROM ${KV} t WHERE key IN (${names.join(", ")}) AND ${live("t")}`,
          params
        )
      );
      const byKey = new Map(rows.map((row) => [String(row["key"]), row]));
      return keys.map((key) => {
        const row = byKey.get(key);
        return row
          ? { value: String(row["value"]), version: String(row["version"]) }
          : undefined;
      });
    },
    write,
    remove,
    incr: async (key, opts) => {
      const by = Math.trunc(opts.by ?? 1);
      const rows = await query(
        sql(
          `INSERT INTO ${KV} AS t (key, value, version, expires_at) VALUES (:key, :first, :version, :exp) ON CONFLICT (key) DO UPDATE SET value = CASE WHEN ${live("t")} THEN CAST(CAST(t.value AS BIGINT) + CAST(:by AS BIGINT) AS TEXT) ELSE excluded.value END, version = excluded.version, expires_at = CASE WHEN ${live("t")} THEN t.expires_at ELSE excluded.expires_at END RETURNING value`,
          {
            key,
            first: String(by),
            by,
            version: newVersion(),
            exp: Date.now() + opts.ttlMs,
            now: Date.now(),
          }
        )
      );
      sweep();
      return num(rows[0]?.["value"]);
    },

    indexAdd: async (index, member, score, opts) => {
      await query(
        sql(
          `INSERT INTO ${IX} (idx, member, score) VALUES (:index, :member, :score) ON CONFLICT (idx, member) DO ${opts?.onlyIfAbsent ? "NOTHING" : "UPDATE SET score = excluded.score"}`,
          { index, member, score }
        )
      );
    },
    indexRemove: async (index, member) => {
      await query(
        sql(`DELETE FROM ${IX} WHERE idx = :index AND member = :member`, {
          index,
          member,
        })
      );
    },
    indexRange: async (index, range) => {
      const params: Record<string, unknown> = {
        index,
        limit: range.limit + 1,
      };
      let where = rangeWhere(range, params);
      if (range.after !== undefined) {
        const [score, member] = JSON.parse(range.after) as [number, string];
        params["as"] = score;
        params["am"] = member;
        where += " AND (score > :as OR (score = :as AND member > :am))";
      }
      const rows = await query(
        sql(
          `SELECT member, score FROM ${IX} WHERE idx = :index${where} ORDER BY score, member LIMIT :limit`,
          params
        )
      );
      const items: IndexEntry[] = rows.slice(0, range.limit).map((row) => ({
        member: String(row["member"]),
        score: num(row["score"]),
      }));
      const last = items[items.length - 1];
      return rows.length > range.limit && last
        ? { items, next: JSON.stringify([last.score, last.member]) }
        : { items };
    },
    indexCount: async (index, range = {}) => {
      const params: Record<string, unknown> = { index };
      const where = rangeWhere(range, params);
      const rows = await query(
        sql(
          `SELECT COUNT(*) AS n FROM ${IX} WHERE idx = :index${where}`,
          params
        )
      );
      return num(rows[0]?.["n"]);
    },

    logAppend: async (stream, value, opts) => {
      const now = Date.now();
      const token = newVersion();
      const params: Record<string, unknown> = {
        stream,
        value,
        now,
        token,
        epoch: newEpoch(),
        max: Math.max(0, Math.trunc(opts.maxEvents)),
      };
      const dedupe = opts.dedupe;
      let cond = "1 = 1";
      const steps: string[] = [];
      if (dedupe) {
        params["dkey"] = dedupe.key;
        params["dexp"] = now + dedupe.ttlMs;
        cond = `EXISTS (SELECT 1 FROM ${KV} d WHERE d.key = :dkey AND d.version = :token)`;
        // Claim the dedupe key; a live record means a duplicate.
        steps.push(
          `INSERT INTO ${KV} AS t (key, value, version, expires_at) VALUES (:dkey, '', :token, :dexp) ON CONFLICT (key) DO UPDATE SET value = excluded.value, version = excluded.version, expires_at = excluded.expires_at WHERE NOT ${live("t")}`
        );
      }
      steps.push(
        // A missing head mints a new epoch over an empty log.
        `DELETE FROM ${LOG} WHERE stream = :stream AND NOT EXISTS (SELECT 1 FROM ${HEAD} h WHERE h.stream = :stream) AND ${cond}`,
        `INSERT INTO ${HEAD} (stream, epoch, seq) SELECT CAST(:stream AS TEXT), CAST(:epoch AS TEXT), 0 WHERE ${cond} ON CONFLICT (stream) DO NOTHING`,
        `UPDATE ${HEAD} SET seq = seq + 1 WHERE stream = :stream AND ${cond}`,
        `INSERT INTO ${LOG} (stream, seq, value, at) SELECT stream, seq, CAST(:value AS TEXT), CAST(:now AS BIGINT) FROM ${HEAD} WHERE stream = :stream AND ${cond}`,
        `DELETE FROM ${LOG} WHERE stream = :stream AND seq <= (SELECT seq FROM ${HEAD} WHERE stream = :stream) - :max AND ${cond}`
      );
      if (dedupe) {
        steps.push(
          `UPDATE ${KV} SET value = (SELECT CAST(seq AS TEXT) FROM ${HEAD} WHERE stream = :stream) WHERE key = :dkey AND version = :token`
        );
      }
      if (opts.mark) {
        params["mindex"] = opts.mark.index;
        params["mmember"] = opts.mark.member;
        params["mscore"] = opts.mark.score;
        steps.push(
          `INSERT INTO ${IX} (idx, member, score) SELECT CAST(:mindex AS TEXT), CAST(:mmember AS TEXT), CAST(:mscore AS DOUBLE PRECISION) WHERE ${cond} ON CONFLICT (idx, member) DO NOTHING`
        );
        if (opts.notify !== undefined && options.notifySql && options.signal) {
          params["notify"] = opts.notify;
          steps.push(
            `${options.notifySql(
              `CAST(:notify AS TEXT) || chr(10) || CAST(:mmember AS TEXT) || ':' || CAST(seq AS TEXT)`
            )} FROM ${HEAD} WHERE stream = :stream AND ${cond}`
          );
        }
      }
      steps.push(
        `SELECT (SELECT seq FROM ${HEAD} WHERE stream = :stream) AS seq, (SELECT epoch FROM ${HEAD} WHERE stream = :stream) AS epoch, ${
          dedupe
            ? `(SELECT value FROM ${KV} t WHERE t.key = :dkey AND ${live("t")}) AS dvalue, CASE WHEN ${cond} THEN 1 ELSE 0 END AS ok`
            : "NULL AS dvalue, 1 AS ok"
        }`
      );
      const results = await atomic(
        steps.map((text) => sql(text, pickParams(text, params)))
      );
      const row = results[results.length - 1]![0]!;
      if (num(row["ok"]) !== 1) {
        const stored = str(row["dvalue"]);
        return {
          duplicate: true,
          seq: stored && /^\d+$/.test(stored) ? Number(stored) : null,
        } satisfies LogAppendResult;
      }
      return {
        duplicate: false,
        seq: num(row["seq"]),
        epoch: String(row["epoch"]),
      };
    },
    logRange: async (stream, range) => {
      const after = range.after ?? 0;
      const statements = [
        sql(
          `SELECT h.epoch AS epoch, h.seq AS head, (SELECT MIN(seq) FROM ${LOG} l WHERE l.stream = :stream) AS first FROM ${HEAD} h WHERE h.stream = :stream`,
          { stream }
        ),
      ];
      if (range.limit > 0) {
        statements.push(
          sql(
            `SELECT seq, value FROM ${LOG} WHERE stream = :stream AND seq > :after ORDER BY seq LIMIT :limit`,
            { stream, after, limit: range.limit }
          )
        );
      }
      const [meta, rows = []] = await atomic(statements);
      const headRow = meta![0];
      const head = headRow ? num(headRow["head"]) : 0;
      const first =
        headRow && headRow["first"] !== null && headRow["first"] !== undefined
          ? num(headRow["first"])
          : head + 1;
      return {
        entries: headRow
          ? rows.map((row) => ({
              seq: num(row["seq"]),
              value: String(row["value"]),
            }))
          : [],
        epoch: headRow ? String(headRow["epoch"]) : null,
        first,
        head,
      };
    },
    logTrim: async (stream, trim) => {
      const rows = await query(
        sql(
          `DELETE FROM ${LOG} WHERE stream = :stream AND seq < :before RETURNING seq`,
          { stream, before: trim.before }
        )
      );
      return rows.length;
    },
    logDelete: async (stream) => {
      await atomic([
        sql(`DELETE FROM ${HEAD} WHERE stream = :stream`, { stream }),
        sql(`DELETE FROM ${LOG} WHERE stream = :stream`, { stream }),
      ]);
    },
    removePrefix: async (prefix) => {
      const params = { prefix, n: prefix.length };
      const match = (column: string) => `substr(${column}, 1, :n) = :prefix`;
      const [kv, ix, heads, logs] = await atomic([
        sql(
          `DELETE FROM ${KV} AS t WHERE ${match("key")} AND ${live("t")} RETURNING key`,
          { ...params, now: Date.now() }
        ),
        sql(`DELETE FROM ${IX} WHERE ${match("idx")} RETURNING idx`, params),
        sql(
          `DELETE FROM ${HEAD} WHERE ${match("stream")} RETURNING stream`,
          params
        ),
        sql(
          `DELETE FROM ${LOG} WHERE ${match("stream")} RETURNING stream`,
          params
        ),
      ]);
      const distinct = (rows: SqlRow[], column: string) =>
        new Set(rows.map((row) => String(row[column]))).size;
      const streams = new Set([
        ...heads!.map((row) => String(row["stream"])),
        ...logs!.map((row) => String(row["stream"])),
      ]);
      return kv!.length + distinct(ix!, "idx") + streams.size;
    },
  };
  if (options.signal) storage.signal = options.signal;
  return storage;
}

/** Keeps only the parameters a statement references. */
function pickParams(
  text: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const match of text.matchAll(/:([a-z][a-z0-9_]*)/gi)) {
    const name = match[1]!;
    if (name in params) picked[name] = params[name];
  }
  return picked;
}
