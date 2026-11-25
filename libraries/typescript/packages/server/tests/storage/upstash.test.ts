/**
 * `upstashStorage` against serverless-redis-http (the Upstash REST protocol
 * in front of Redis 7, `MCP_USE_TEST_UPSTASH_URL`/`_TOKEN`, required under
 * CI) and against real Upstash when the repository secrets exist.
 */
import { describe, expect, it } from "vitest";
import { upstashStorage } from "../../src/storage/adapters/upstash.js";
import { runStorageConformance } from "../../src/storage/conformance.js";

function service(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required && process.env["CI"] === "true") {
    throw new Error(`${name} must be set when CI=true`);
  }
  return value || undefined;
}

const targets = [
  {
    name: "serverless-redis-http",
    url: service("MCP_USE_TEST_UPSTASH_URL"),
    token: service("MCP_USE_TEST_UPSTASH_TOKEN"),
  },
  {
    name: "real Upstash",
    url: service("UPSTASH_TEST_REST_URL", false),
    token: service("UPSTASH_TEST_REST_TOKEN", false),
  },
];

const EXPECTED = {
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
  SIGNAL: "skip",
  BATCH: "pass",
  "REMOVE-PREFIX": "pass",
};

describe.each(targets)("upstashStorage on $name", ({ url, token }) => {
  it.skipIf(!url || !token)(
    "passes the storage conformance suite",
    async () => {
      const open = (prefix: string) =>
        upstashStorage({ url: url!, token: token!, prefix });
      const report = await runStorageConformance(open(""), {
        ttlMs: 500,
        open,
      });
      expect(report.kind).toBe("upstash");
      expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
      expect(
        Object.fromEntries(report.checks.map((c) => [c.id, c.status]))
      ).toEqual(EXPECTED);
    },
    60_000
  );

  it.skipIf(!url || !token)(
    "returns one result per op from a REST pipeline batch, errors in place",
    async () => {
      const store = upstashStorage({
        url: url!,
        token: token!,
        prefix: `wp07-batch-${Date.now()}:`,
      });
      const [written, read, conflict, removed] = await store.batch!([
        { op: "write", key: "k", value: "v" },
        { op: "read", key: "absent" },
        { op: "write", key: "k2", value: "x", ifVersion: "nope" },
        { op: "remove", key: "k" },
      ]);
      expect(typeof written).toBe("string");
      expect([read, conflict, removed]).toEqual([undefined, false, true]);
    }
  );
});
