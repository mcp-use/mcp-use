import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import { createTokenTransactions } from "./auth/token-transaction.js";

/** Open the application's database; schema changes are a separate command. */
export async function openConfiguration() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const configPath = process.env.FIREBASE_WEB_CONFIG_FILE;
  if (!configPath) throw new Error("FIREBASE_WEB_CONFIG_FILE is required");
  const firebase = JSON.parse(readFileSync(resolve(configPath), "utf8"));
  const secret =
    process.env.BETTER_AUTH_SECRET ??
    (process.env.BETTER_AUTH_SECRET_FILE
      ? readFileSync(
          resolve(process.env.BETTER_AUTH_SECRET_FILE),
          "utf8"
        ).trim()
      : undefined);
  if (!secret || secret.length < 32)
    throw new Error(
      "Supply a stable BETTER_AUTH_SECRET or BETTER_AUTH_SECRET_FILE"
    );
  const url = new URL(process.env.MCP_URL ?? "http://localhost:3038");
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "MCP_URL must be an origin without credentials, path, query, or fragment"
    );
  const origin = url.origin;
  let pool: Pool | undefined;
  let sqlite: import("node:sqlite").DatabaseSync | undefined;
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      idleTimeoutMillis: 10_000,
    });
    pool.on("error", () =>
      console.error("Authentication database connection failed")
    );
  } else if (process.env.SQLITE_FILE && process.env.NODE_ENV !== "production") {
    if (process.env.SQLITE_FILE === ":memory:")
      throw new Error("SQLITE_FILE must name a persistent local database");
    const { DatabaseSync } = await import("node:sqlite");
    const file = resolve(process.env.SQLITE_FILE);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    sqlite = new DatabaseSync(file);
    chmodSync(file, 0o600);
    sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  } else {
    throw new Error(
      "DATABASE_URL is required; SQLITE_FILE is available for single-process local use"
    );
  }
  const transactions = createTokenTransactions(pool);
  return {
    origin,
    auth: {
      resource: new URL("/mcp", origin),
      firebase,
      secret,
      database: pool ? transactions.database! : sqlite!,
      runTokenOperation: transactions.run,
    },
    async close() {
      if (pool) await pool.end();
      sqlite?.close();
    },
  };
}
