/**
 * The OAuth storage factories moved from `src/oauth/storage.ts` to
 * `src/storage/adapters/*`. `mcp-use/oauth/storage` keeps exporting the same
 * values, and each adapter keeps its OAuth behaviour against the real
 * databases CI runs as services.
 */
import IORedis, { Cluster } from "ioredis";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as oauthStorage from "../../src/oauth/storage.js";
import type { OAuthProxyStorage } from "../../src/oauth/storage.js";
import * as storage from "../../src/storage/index.js";

function service(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required && process.env["CI"] === "true") {
    throw new Error(`${name} must be set when CI=true`);
  }
  return value || undefined;
}

const REDIS_URL = service("MCP_USE_TEST_REDIS_URL");
const CLUSTER_URL = service("MCP_USE_TEST_REDIS_CLUSTER_URL");
const POSTGRES_URL = service("MCP_USE_TEST_POSTGRES_URL");
const UPSTASH_URL = service("MCP_USE_TEST_UPSTASH_URL");
const UPSTASH_TOKEN = service("MCP_USE_TEST_UPSTASH_TOKEN");
// Real Upstash runs only where the repository's secrets exist (not forks).
const REAL_UPSTASH_URL = service("UPSTASH_TEST_REST_URL", false);
const REAL_UPSTASH_TOKEN = service("UPSTASH_TEST_REST_TOKEN", false);

const closers: Array<() => Promise<unknown>> = [];
afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The OAuthProxyStorage contract oauthProxy relies on. */
async function oauthContract(store: OAuthProxyStorage): Promise<void> {
  const key = (name: string) => `wp02-oauth:${run}:${name}`;
  expect(await store.get(key("absent"))).toBeUndefined();
  await store.set(key("a"), "one", 60);
  expect(await store.get(key("a"))).toBe("one");
  await store.set(key("a"), "two", 60);
  expect(await store.get(key("a"))).toBe("two");
  await store.delete(key("a"));
  await store.delete(key("a"));
  expect(await store.get(key("a"))).toBeUndefined();

  await store.set(key("code"), "grant", 60);
  const taken = await Promise.all(
    Array.from({ length: 20 }, () => store.take(key("code")))
  );
  expect(taken.filter((value) => value !== undefined)).toEqual(["grant"]);
  expect(await store.take(key("code"))).toBeUndefined();

  const added = await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.add(key("lock"), `l${i}`, 60))
  );
  expect(added.filter(Boolean)).toEqual([true]);
  expect(await store.get(key("lock"))).toBe(`l${added.indexOf(true)}`);
  await store.delete(key("lock"));
}

describe("mcp-use/oauth/storage after the split", () => {
  it("exports the same runtime values as before", () => {
    expect(Object.keys(oauthStorage).sort()).toEqual([
      "OAuthProxyDurableObject",
      "cloudflareStorage",
      "firestoreStorage",
      "memoryStorage",
      "postgresStorage",
      "redisStorage",
      "upstashStorage",
    ]);
  });

  it("re-exports the factories of mcp-use/storage, except Firestore", () => {
    expect([
      oauthStorage.memoryStorage,
      oauthStorage.upstashStorage,
      oauthStorage.redisStorage,
      oauthStorage.postgresStorage,
      oauthStorage.cloudflareStorage,
    ]).toEqual([
      storage.memoryStorage,
      storage.upstashStorage,
      storage.redisStorage,
      storage.postgresStorage,
      storage.cloudflareStorage,
    ]);
    expect("firestoreStorage" in storage).toBe(false);
  });

  it("memoryStorage keeps the contract", async () => {
    await oauthContract(oauthStorage.memoryStorage());
  });

  it.skipIf(!REDIS_URL)(
    "redisStorage keeps the contract on Redis via ioredis",
    async () => {
      const client = new IORedis(REDIS_URL!);
      closers.push(() => client.quit());
      await oauthContract(oauthStorage.redisStorage(client));
      await oauthContract(oauthStorage.redisStorage(() => client));
    }
  );

  it.skipIf(!CLUSTER_URL)(
    "redisStorage keeps the contract on a 3-shard Redis Cluster",
    async () => {
      const { hostname, port } = new URL(CLUSTER_URL!);
      const cluster = new Cluster([{ host: hostname, port: Number(port) }]);
      closers.push(() => cluster.quit());
      const nodes = String(await cluster.call("CLUSTER", "NODES"))
        .trim()
        .split("\n")
        .filter((line) => line.includes("master"));
      expect(nodes).toHaveLength(3);
      await oauthContract(oauthStorage.redisStorage(cluster));
    }
  );

  it.skipIf(!UPSTASH_URL || !UPSTASH_TOKEN)(
    "upstashStorage keeps the contract over the Upstash REST protocol",
    async () => {
      await oauthContract(
        oauthStorage.upstashStorage({
          url: UPSTASH_URL!,
          token: UPSTASH_TOKEN!,
        })
      );
    }
  );

  it.skipIf(!REAL_UPSTASH_URL || !REAL_UPSTASH_TOKEN)(
    "upstashStorage keeps the contract on real Upstash",
    async () => {
      await oauthContract(
        oauthStorage.upstashStorage({
          url: REAL_UPSTASH_URL!,
          token: REAL_UPSTASH_TOKEN!,
        })
      );
    }
  );

  it.skipIf(!POSTGRES_URL)(
    "postgresStorage keeps the contract and the mcp_use_oauth table shape",
    async () => {
      const pool = new pg.Pool({ connectionString: POSTGRES_URL });
      closers.push(() => pool.end());
      await oauthContract(oauthStorage.postgresStorage({ client: pool }));
      const { rows } = await pool.query(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'mcp_use_oauth' ORDER BY ordinal_position"
      );
      expect(rows).toEqual([
        { column_name: "key", data_type: "text", is_nullable: "NO" },
        { column_name: "value", data_type: "text", is_nullable: "NO" },
        {
          column_name: "expires_at",
          data_type: "timestamp with time zone",
          is_nullable: "NO",
        },
      ]);
    }
  );
});
