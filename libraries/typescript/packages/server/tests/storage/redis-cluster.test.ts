/**
 * `redisStorage` on the 3-shard Redis Cluster CI starts
 * (`MCP_USE_TEST_REDIS_CLUSTER_URL`, required under CI): every multi-key
 * script is legal because a log's keys share the caller's hash tag (R-4).
 */
import { Cluster } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { redisStorage } from "../../src/storage/adapters/redis.js";
import { runStorageConformance } from "../../src/storage/conformance.js";

const CLUSTER_URL = process.env["MCP_USE_TEST_REDIS_CLUSTER_URL"] || undefined;
if (!CLUSTER_URL && process.env["CI"] === "true") {
  throw new Error("MCP_USE_TEST_REDIS_CLUSTER_URL must be set when CI=true");
}

const clusters: Cluster[] = [];
afterAll(async () => {
  await Promise.all(clusters.map((cluster) => cluster.quit()));
});
function cluster() {
  const { hostname, port } = new URL(CLUSTER_URL!);
  const client = new Cluster([{ host: hostname, port: Number(port) }]);
  clusters.push(client);
  return client;
}

describe.skipIf(!CLUSTER_URL)("redisStorage on a 3-shard Redis Cluster", () => {
  it("passes conformance except REMOVE-PREFIX, which scans one node", async () => {
    const report = await runStorageConformance(redisStorage(cluster()), {
      ttlMs: 300,
      open: (prefix) => redisStorage(cluster(), { prefix }),
      only: [
        "CAS",
        "INCR",
        "INDEX",
        "TTL",
        "PREFIX",
        "LOG-SEQ",
        "LOG-DEDUPE",
        "LOG-DEDUPE-TTL",
        "LOG-MARK",
        "LOG-RANGE",
        "LOG-CAP",
        "LOG-TRIM",
        "LOG-EPOCH",
        "SIGNAL",
        "BATCH",
      ],
    });
    expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(report.checks.filter((c) => c.status === "pass")).toHaveLength(15);
  });

  it("appends to logs whose hash tags land on different shards", async () => {
    const store = redisStorage(cluster());
    const slots = new Set<number>();
    const tags = ["a", "b", "c", "d", "e", "f"].map(
      (t) => `{wp07-${Date.now()}-${t}}`
    );
    for (const tag of tags) {
      const result = await store.logAppend(`${tag}:log`, "x", {
        maxEvents: 5,
        dedupe: { key: `${tag}:dedupe`, ttlMs: 10_000 },
        mark: { index: `${tag}:active`, member: "m", score: 1 },
        notify: `${tag}:wake`,
      });
      expect(result).toMatchObject({ duplicate: false, seq: 1 });
      slots.add(
        Number(await clusters[0]!.call("CLUSTER", "KEYSLOT", `${tag}:log`))
      );
      await store.logDelete(`${tag}:log`);
      await store.remove(`${tag}:dedupe`);
      await store.indexRemove(`${tag}:active`, "m");
    }
    expect(slots.size).toBeGreaterThan(1);
  });
});
