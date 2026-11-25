import IORedis from "ioredis";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { memoryStorage } from "../../src/oauth/proxy/storage.js";
import { cloudflareStorage } from "../../src/storage/adapters/cloudflare-d1.js";
import { postgresStorage } from "../../src/storage/adapters/postgres.js";
import { redisStorage } from "../../src/storage/adapters/redis.js";
import { upstashStorage } from "../../src/storage/adapters/upstash.js";
import {
  applyStoragePrefix,
  validateStoragePrefix,
} from "../../src/storage/prefix.js";
import { ReferenceDatabase } from "./reference-storage.js";

function service(name: string): string | undefined {
  const value = process.env[name];
  if (!value && process.env["CI"] === "true") {
    throw new Error(`${name} must be set when CI=true`);
  }
  return value || undefined;
}

const REDIS_URL = service("MCP_USE_TEST_REDIS_URL");
const POSTGRES_URL = service("MCP_USE_TEST_POSTGRES_URL");
const UPSTASH_URL = service("MCP_USE_TEST_UPSTASH_URL");
const UPSTASH_TOKEN = service("MCP_USE_TEST_UPSTASH_TOKEN");

const clients: IORedis[] = [];
const pools: pg.Pool[] = [];
afterAll(async () => {
  await Promise.all([
    ...clients.map((client) => client.quit()),
    ...pools.map((pool) => pool.end()),
  ]);
});

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

describe("validateStoragePrefix", () => {
  it("accepts any prefix without braces and treats undefined as empty", () => {
    expect(validateStoragePrefix(undefined, "x")).toBe("");
    expect(validateStoragePrefix("t/srv_8f/prod/", "x")).toBe("t/srv_8f/prod/");
  });

  it("rejects braces in every factory, which would change the hash tag", () => {
    const factories = [
      () =>
        upstashStorage({ url: "https://u.example", token: "t", prefix: "a{" }),
      () => redisStorage({ call: async () => null }, { prefix: "a}" }),
      () =>
        postgresStorage({
          client: { query: async () => ({ rows: [] }) },
          prefix: "{a}",
        }),
      () =>
        cloudflareStorage({
          d1: { prepare: () => ({}) as never },
          prefix: "{",
        }),
      () =>
        cloudflareStorage({
          durableObject: {
            idFromName: () => "id",
            get: () => ({ fetch: async () => Response.json({}) }),
          },
          prefix: "do}",
        }),
    ];
    for (const factory of factories) {
      expect(factory).toThrow(TypeError);
    }
  });
});

describe("applyStoragePrefix", () => {
  it("returns the store itself for an empty prefix", () => {
    const storage = memoryStorage();
    expect(applyStoragePrefix(storage, "")).toBe(storage);
  });

  it("prefixes every key, index, log, dedupe key, counter and channel, and nothing else", async () => {
    const db = new ReferenceDatabase();
    const store = db.store("p/");
    const notified: string[] = [];
    await db.store().signal!.subscribe("p/ch", (message) => {
      notified.push(message);
    });
    await store.write("kv", "value");
    await store.set("oauth", "token", 60);
    await store.incr("counter", { ttlMs: 60_000 });
    await store.indexAdd("ix", "member", 1);
    const appended = await store.logAppend("log", "entry", {
      maxEvents: 10,
      dedupe: { key: "dedupe", ttlMs: 60_000 },
      mark: { index: "marks", member: "mark", score: 2 },
      notify: "ch",
    });
    await store.batch!([
      { op: "write", key: "batched", value: "b" },
      { op: "indexAdd", index: "batch-ix", member: "bm", score: 3 },
    ]);
    expect([...db.values.keys()].sort()).toEqual([
      "p/batched",
      "p/counter",
      "p/dedupe",
      "p/kv",
      "p/oauth",
    ]);
    expect([...db.indexes.keys()].sort()).toEqual([
      "p/batch-ix",
      "p/ix",
      "p/marks",
    ]);
    expect([...db.logs.keys()]).toEqual(["p/log"]);
    expect(notified).toEqual([`mark:${appended.seq}`]);
    expect((await store.indexRange("marks", { limit: 10 })).items).toEqual([
      { member: "mark", score: 2 },
    ]);
    expect(
      (await store.logRange("log", { after: null, limit: 10 })).entries
    ).toEqual([{ seq: 1, value: "entry" }]);
    expect(await store.readMany!(["kv", "batched"])).toEqual([
      { value: "value", version: expect.any(String) as string },
      { value: "b", version: expect.any(String) as string },
    ]);
    await db.store().write("other", "x");
    expect(await store.removePrefix!("")).toBe(9);
    expect([...db.values.keys()]).toEqual(["other"]);
  });

  it("keeps optional methods detectable by presence and reports the inner store's flags", () => {
    const {
      readMany: _readMany,
      removePrefix: _removePrefix,
      ...bare
    } = new ReferenceDatabase().store();
    const prefixed = applyStoragePrefix(bare, "p/");
    expect(
      ["readMany", "removePrefix"].filter((name) => name in prefixed)
    ).toEqual([]);
    expect(["batch", "signal"].filter((name) => name in prefixed)).toEqual([
      "batch",
      "signal",
    ]);
    expect([prefixed.kind, prefixed.durable, prefixed.shared]).toEqual([
      "reference",
      true,
      true,
    ]);
  });
});

describe("factory prefix option", () => {
  it("upstashStorage sends prefixed keys over the REST protocol", async () => {
    const bodies: unknown[] = [];
    const storage = upstashStorage({
      url: "https://u.example/",
      token: "t",
      prefix: "app/",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ result: "OK" });
      },
    });
    await storage.set("k", "v", 60);
    await storage.add("k2", "v", 60);
    await storage.take("k3");
    await storage.delete("k4");
    expect(bodies).toEqual([
      ["SET", "app/k", "v", "EX", "60"],
      ["SET", "app/k2", "v", "NX", "EX", "60"],
      ["GETDEL", "app/k3"],
      ["DEL", "app/k4"],
    ]);
  });

  it.skipIf(!POSTGRES_URL)(
    "postgresStorage stores prefixed keys in the mcp_use_oauth table",
    async () => {
      const pool = new pg.Pool({ connectionString: POSTGRES_URL });
      pools.push(pool);
      const prefix = `wp02-${run}/`;
      const storage = postgresStorage({ client: pool, prefix });
      await storage.set("k", "v", 60);
      const rows = async () =>
        (
          await pool.query(
            "SELECT key, value FROM mcp_use_oauth WHERE key = ANY($1) ORDER BY key",
            [[`${prefix}k`, "k"]]
          )
        ).rows;
      expect(await rows()).toEqual([{ key: `${prefix}k`, value: "v" }]);
      expect(await storage.take("k")).toBe("v");
      expect(await rows()).toEqual([]);
    }
  );

  it.skipIf(!REDIS_URL)(
    "redisStorage over ioredis writes under the prefix",
    async () => {
      const client = new IORedis(REDIS_URL!);
      clients.push(client);
      const storage = redisStorage(client, { prefix: `wp02-${run}/` });
      await storage.set("k", "v", 60);
      expect(await client.get(`wp02-${run}/k`)).toBe("v");
      expect(await client.get("k")).toBeNull();
      expect(await storage.take("k")).toBe("v");
      expect(await client.exists(`wp02-${run}/k`)).toBe(0);
    }
  );

  it.skipIf(!UPSTASH_URL || !UPSTASH_TOKEN)(
    "upstashStorage over an Upstash-REST endpoint writes under the prefix",
    async () => {
      const raw = upstashStorage({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! });
      const storage = upstashStorage({
        url: UPSTASH_URL!,
        token: UPSTASH_TOKEN!,
        prefix: `wp02-${run}/`,
      });
      await storage.set("k", "v", 60);
      expect([await raw.get(`wp02-${run}/k`), await raw.get("k")]).toEqual([
        "v",
        undefined,
      ]);
      await storage.delete("k");
      expect(await raw.get(`wp02-${run}/k`)).toBeUndefined();
    }
  );
});
