import { describe, expect, it } from "vitest";
import { isMemoryStorage } from "../../src/oauth/proxy/storage.js";
import { memoryStorage } from "../../src/storage/adapters/memory.js";
import { runStorageConformance } from "../../src/storage/conformance.js";

describe("memoryStorage", () => {
  it("passes the storage conformance suite", async () => {
    const report = await runStorageConformance(memoryStorage(), {
      ttlMs: 150,
    });
    expect(
      Object.fromEntries(report.checks.map((c) => [c.id, c.status]))
    ).toEqual({
      CAS: "pass",
      INCR: "pass",
      INDEX: "pass",
      TTL: "pass",
      PREFIX: "skip",
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
      BATCH: "skip",
      "REMOVE-PREFIX": "pass",
    });
  });

  it("returns a new empty store on every call", async () => {
    const a = memoryStorage();
    const b = memoryStorage();
    await a.write("k", "v");
    expect(await b.read("k")).toBe(undefined);
    expect([a.kind, a.durable, a.shared]).toEqual(["memory", false, false]);
  });

  it("is recognised by oauthProxy as a memory store, with or without a prefix", () => {
    expect(isMemoryStorage(memoryStorage())).toBe(true);
    expect(isMemoryStorage(memoryStorage({ prefix: "app:" }))).toBe(true);
  });

  it("starts at seq 1 in a new epoch after logDelete", async () => {
    const store = memoryStorage();
    const first = await store.logAppend("s", "a", { maxEvents: 10 });
    await store.logDelete("s");
    const second = await store.logAppend("s", "b", { maxEvents: 10 });
    if (first.duplicate || second.duplicate) throw new Error("duplicate");
    expect(second.seq).toBe(1);
    expect(second.epoch).not.toBe(first.epoch);
  });
});
