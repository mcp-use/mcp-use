/**
 * `redisStorage` against the Redis service CI runs (`MCP_USE_TEST_REDIS_URL`,
 * Redis 7). Skipped locally when the variable is unset; required under CI.
 */
import IORedis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { redisStorage } from "../../src/storage/adapters/redis.js";
import { runStorageConformance } from "../../src/storage/conformance.js";
import { runStorageIsolationCheck } from "../../src/storage/isolation.js";

function service(name: string): string | undefined {
  const value = process.env[name];
  if (!value && process.env["CI"] === "true") {
    throw new Error(`${name} must be set when CI=true`);
  }
  return value || undefined;
}

const REDIS_URL = service("MCP_USE_TEST_REDIS_URL");
const clients: IORedis[] = [];
afterAll(async () => {
  await Promise.all(clients.map((client) => client.quit()));
});
function client(url = REDIS_URL!) {
  const redis = new IORedis(url, { lazyConnect: false });
  clients.push(redis);
  return redis;
}
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!REDIS_URL)("redisStorage", () => {
  it("passes the storage conformance suite", async () => {
    const base = client();
    const report = await runStorageConformance(redisStorage(base), {
      ttlMs: 300,
      open: (prefix) => redisStorage(client(), { prefix }),
    });
    expect(report.kind).toBe("redis");
    expect(
      Object.fromEntries(report.checks.map((c) => [c.id, c.status]))
    ).toEqual({
      CAS: "pass",
      INCR: "pass",
      INDEX: "pass",
      TTL: "pass",
      PREFIX: "pass",
      "LOG-SEQ": "pass",
      "LOG-DEDUPE": "pass",
      "LOG-DEDUPE-TTL": "pass",
      "LOG-MARK": "pass",
      "LOG-ATOMIC": "manual",
      "LOG-RANGE": "pass",
      "LOG-CAP": "pass",
      "LOG-TRIM": "pass",
      "LOG-EPOCH": "pass",
      SIGNAL: "pass",
      BATCH: "pass",
      "REMOVE-PREFIX": "pass",
    });
  });

  it("passes conformance as an ACL user limited to its prefix, and cannot reach another prefix", async () => {
    const admin = client();
    const user = `wp07-${run}`;
    const prefix = `app-${run}:`;
    await admin.call(
      "ACL",
      "SETUSER",
      user,
      "on",
      ">wp07-pass",
      `~${prefix}*`,
      `&${prefix}*`,
      "+@all"
    );
    try {
      const url = new URL(REDIS_URL!);
      url.username = user;
      url.password = "wp07-pass";
      const limited = () => client(url.toString());
      const report = await runStorageConformance(
        redisStorage(limited(), { prefix }),
        {
          prefix,
          ttlMs: 300,
          open: (p) => redisStorage(limited(), { prefix: p }),
        }
      );
      expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
      const isolation = await runStorageIsolationCheck({
        allowed: redisStorage(client(), { prefix: `other-${run}:` }),
        denied: redisStorage(limited(), { prefix }),
      });
      expect(isolation.passed).toBe(true);
    } finally {
      await admin.call("ACL", "DELUSER", user);
    }
  });

  it("keeps OAuth values written with set readable after a versioned write", async () => {
    const store = redisStorage(client(), { prefix: `oauth-${run}:` });
    await store.set("a", "plain", 60);
    expect(await store.read("a")).toEqual({ value: "plain", version: "p" });
    const version = await store.write("a", "versioned", { ifVersion: "p" });
    expect(typeof version).toBe("string");
    expect(await store.get("a")).toBe("versioned");
    expect(await store.take("a")).toBe("versioned");
  });

  it("turns signal off with subscriber: false", () => {
    const store = redisStorage(client(), { subscriber: false });
    expect(store.capabilities).toEqual({ signal: false, batch: true });
    expect(store.signal).toBe(undefined);
  });
});
