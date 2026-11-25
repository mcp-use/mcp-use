/**
 * postgresStorage against the real Postgres CI runs as a service
 * (MCP_USE_TEST_POSTGRES_URL). Each run uses its own schema and prefix.
 */
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { postgresStorage } from "../../src/storage/adapters/postgres.js";
import { runStorageConformance } from "../../src/storage/conformance.js";

const POSTGRES_URL = process.env["MCP_USE_TEST_POSTGRES_URL"] || undefined;
if (!POSTGRES_URL && process.env["CI"] === "true") {
  throw new Error("MCP_USE_TEST_POSTGRES_URL must be set when CI=true");
}

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const schema = `wp08_${run}`;
const pools: pg.Pool[] = [];
const pool = () => {
  const created = new pg.Pool({ connectionString: POSTGRES_URL, max: 8 });
  pools.push(created);
  return created;
};

afterAll(async () => {
  if (pools[0]) {
    await pools[0].query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pools[0].query(`DROP TABLE IF EXISTS wp08_oauth_${run}`);
  }
  await Promise.all(pools.map((p) => p.end()));
});

function failures(report: Awaited<ReturnType<typeof runStorageConformance>>) {
  return report.checks.filter((c) => c.status === "fail");
}

describe.skipIf(!POSTGRES_URL)("postgresStorage", () => {
  it("passes the storage conformance suite with LISTEN signal", async () => {
    const shared = pool();
    await shared.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    const open = (prefix: string) =>
      postgresStorage({ pool: shared, schema, prefix });
    const report = await runStorageConformance(open("a:"), {
      prefix: "a:",
      open: (prefix) => postgresStorage({ pool: pool(), schema, prefix }),
    });
    expect(failures(report)).toEqual([]);
    expect(report.checks.find((c) => c.id === "SIGNAL")?.status).toBe("pass");
    expect(report.kind).toBe("postgres");
  }, 60_000);

  it("passes the suite with signal: false and reports no signal", async () => {
    const shared = pool();
    await shared.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    const store = postgresStorage({
      pool: shared,
      schema,
      prefix: "b:",
      signal: false,
    });
    expect(store.capabilities).toEqual({ signal: false, batch: false });
    expect(store.signal).toBe(undefined);
    const report = await runStorageConformance(store, {
      prefix: "b:",
      open: (prefix) =>
        postgresStorage({ pool: shared, schema, prefix, signal: false }),
    });
    expect(failures(report)).toEqual([]);
    expect(report.checks.find((c) => c.id === "SIGNAL")?.status).toBe("skip");
  }, 60_000);

  it("passes the suite on a single pg.Client", async () => {
    const shared = pool();
    await shared.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    const client = new pg.Client({ connectionString: POSTGRES_URL });
    await client.connect();
    try {
      const store = postgresStorage({ client, schema, prefix: "c:" });
      expect(store.capabilities.signal).toBe(false);
      const report = await runStorageConformance(store, {
        prefix: "c:",
        open: (prefix) => postgresStorage({ client, schema, prefix }),
      });
      expect(failures(report)).toEqual([]);
    } finally {
      await client.end();
    }
  }, 60_000);

  it("leaves an existing OAuth table byte-identical", async () => {
    const shared = pool();
    const table = `wp08_oauth_${run}`;
    await shared.query(
      `CREATE TABLE ${table} (key text PRIMARY KEY, value text NOT NULL, expires_at timestamptz NOT NULL)`
    );
    await shared.query(
      `INSERT INTO ${table} VALUES ('k1', 'v1', '2099-01-01T00:00:00Z')`
    );
    const snapshot = async () => {
      const columns = await shared.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
        [table]
      );
      const rows = await shared.query(
        `SELECT key, value, expires_at::text AS expires_at FROM ${table} ORDER BY key`
      );
      return { columns: columns.rows, rows: rows.rows };
    };
    const before = await snapshot();
    const store = postgresStorage({ pool: shared, schema, table });
    await shared.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await store.write("events-key", "x");
    await store.logAppend("events-log", "e", { maxEvents: 10 });
    expect(await store.get("k1")).toBe("v1");
    expect(await snapshot()).toEqual(before);
    expect(before.columns).toEqual([
      { column_name: "key", data_type: "text", is_nullable: "NO" },
      { column_name: "value", data_type: "text", is_nullable: "NO" },
      {
        column_name: "expires_at",
        data_type: "timestamp with time zone",
        is_nullable: "NO",
      },
    ]);
  });
});
