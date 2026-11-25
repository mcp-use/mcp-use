import { describe, expect, it } from "vitest";
import {
  runStorageConformance,
  type StorageConformanceReport,
} from "../../src/storage/conformance.js";
import { countingStorage } from "../../src/storage/counting.js";
import { runStorageIsolationCheck } from "../../src/storage/isolation.js";
import {
  assertMcpUseStorage,
  isMcpUseStorage,
  type McpUseStorage,
} from "../../src/storage/types.js";
import { ReferenceDatabase } from "./reference-storage.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function statuses(report: StorageConformanceReport) {
  return Object.fromEntries(
    report.checks.map((result) => [result.id, result.status])
  );
}

const ALL_PASS = {
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
};

/** Runs the suite over stores built by `build` on one reference database. */
function runOn(
  build: (store: McpUseStorage) => McpUseStorage = (store) => store
) {
  const db = new ReferenceDatabase();
  return {
    db,
    report: runStorageConformance(build(db.store()), {
      open: (prefix) => build(db.store(prefix)),
      advanceTime: (ms) => {
        db.now += ms;
      },
    }),
  };
}

describe("runStorageConformance", () => {
  it("passes every check on the reference store and removes what it wrote", async () => {
    const { db, report } = runOn();
    const result = await report;
    expect(result.kind).toBe("reference");
    expect(result.passed).toBe(true);
    expect(statuses(result)).toEqual(ALL_PASS);
    expect(
      result.checks.find((check) => check.id === "LOG-ATOMIC")?.detail
    ).toContain("one script, one transaction or one Durable Object call");
    expect([...db.logs.keys()]).toEqual([]);
    expect([...db.values.keys()]).toEqual([]);
    expect(
      [...db.indexes.values()].filter((members) => members.size > 0)
    ).toEqual([]);
  });

  it("passes on a class-based store whose getters read private fields", async () => {
    const db = new ReferenceDatabase();
    const inner = db.store();
    const methods = Object.keys(inner).filter(
      (name) =>
        typeof (inner as unknown as Record<string, unknown>)[name] ===
        "function"
    );
    class PrivateFieldStore {
      #inner: McpUseStorage;
      constructor(store: McpUseStorage) {
        this.#inner = store;
      }
      get kind() {
        return this.#inner.kind;
      }
      get durable() {
        return this.#inner.durable;
      }
      get shared() {
        return this.#inner.shared;
      }
      get capabilities() {
        return this.#inner.capabilities;
      }
      get signal() {
        return this.#inner.signal;
      }
      static {
        for (const name of methods) {
          Object.defineProperty(this.prototype, name, {
            value(this: PrivateFieldStore, ...args: unknown[]) {
              const store = this.#inner as unknown as Record<
                string,
                (...values: unknown[]) => unknown
              >;
              return store[name]!(...args);
            },
          });
        }
      }
    }
    const open = (prefix?: string) =>
      new PrivateFieldStore(db.store(prefix)) as unknown as McpUseStorage;
    const result = await runStorageConformance(open(), {
      open,
      advanceTime: (ms) => {
        db.now += ms;
      },
    });
    expect(statuses(result)).toEqual(ALL_PASS);
  });

  it("fails CAS when ifVersion: null is not atomic", async () => {
    const { report } = runOn((store) => ({
      ...store,
      write: async (key, value, options) => {
        if (options?.ifVersion !== null)
          return store.write(key, value, options);
        const current = await store.read(key);
        await tick();
        if (current) return false;
        return store.write(key, value, {
          ...(options.ttlMs !== undefined && { ttlMs: options.ttlMs }),
        });
      },
    }));
    const result = await report;
    expect(result.passed).toBe(false);
    expect(statuses(result)).toEqual({ ...ALL_PASS, CAS: "fail" });
  });

  it("fails INCR and TTL when the counter is read, then written", async () => {
    const { report } = runOn((store) => ({
      ...store,
      incr: async (key, options) => {
        const current = Number((await store.read(key))?.value ?? 0);
        await tick();
        const next = current + (options.by ?? 1);
        await store.write(key, String(next), { ttlMs: options.ttlMs });
        return next;
      },
    }));
    expect(statuses(await report)).toEqual({
      ...ALL_PASS,
      INCR: "fail",
      TTL: "fail",
    });
  });

  it("fails INDEX when onlyIfAbsent is ignored", async () => {
    const { report } = runOn((store) => ({
      ...store,
      indexAdd: (index, member, score) => store.indexAdd(index, member, score),
    }));
    const result = await report;
    expect(statuses(result)).toEqual({ ...ALL_PASS, INDEX: "fail" });
    expect(result.checks.find((check) => check.id === "INDEX")?.detail).toMatch(
      /^indexRange order by \(score, member\)/
    );
  });

  it("fails LOG-DEDUPE when the dedupe key is checked outside the append", async () => {
    const { report } = runOn((store) => ({
      ...store,
      logAppend: async (stream, value, options) => {
        const { dedupe, ...rest } = options;
        if (!dedupe) return store.logAppend(stream, value, options);
        const existing = await store.read(dedupe.key);
        if (existing) return { duplicate: true, seq: Number(existing.value) };
        await tick();
        const result = await store.logAppend(stream, value, rest);
        await store.write(dedupe.key, String(result.seq), {
          ttlMs: dedupe.ttlMs,
        });
        return result;
      },
    }));
    expect(statuses(await report)).toEqual({
      ...ALL_PASS,
      "LOG-DEDUPE": "fail",
    });
  });

  it("fails SIGNAL when capabilities.signal is true but signal is absent", async () => {
    const { report } = runOn((store) => {
      const { signal: _signal, ...rest } = store;
      return rest;
    });
    const result = await report;
    expect(statuses(result)).toEqual({ ...ALL_PASS, SIGNAL: "fail" });
  });

  it("skips the optional checks a store does not offer, and PREFIX without open", async () => {
    const db = new ReferenceDatabase();
    const {
      signal: _signal,
      batch: _batch,
      removePrefix: _removePrefix,
      ...store
    } = db.store();
    const result = await runStorageConformance(
      { ...store, capabilities: { signal: false, batch: false } },
      { advanceTime: (ms) => void (db.now += ms) }
    );
    expect(result.passed).toBe(true);
    expect(
      result.checks
        .filter((check) => check.status === "skip")
        .map(({ id, detail }) => ({ id, detail }))
    ).toEqual([
      { id: "PREFIX", detail: "needs options.open" },
      { id: "SIGNAL", detail: "capabilities.signal is false" },
      { id: "BATCH", detail: "capabilities.batch is false" },
      { id: "REMOVE-PREFIX", detail: "removePrefix is absent" },
    ]);
    expect(result.checks.find((check) => check.id === "LOG-SEQ")?.detail).toBe(
      "one client: options.open not given"
    );
  });

  it("runs only the selected checks", async () => {
    const db = new ReferenceDatabase();
    const result = await runStorageConformance(db.store(), {
      only: ["CAS", "LOG-TRIM"],
    });
    expect(
      result.checks.filter((check) => check.status !== "skip").map((c) => c.id)
    ).toEqual(["CAS", "LOG-TRIM"]);
  });
});

describe("runStorageIsolationCheck", () => {
  it("passes for two prefixes on one database", async () => {
    const db = new ReferenceDatabase();
    const report = await runStorageIsolationCheck({
      allowed: db.store("tenant-a/"),
      denied: db.store("tenant-b/"),
    });
    expect(report).toEqual({
      passed: true,
      checks: [
        { id: "ALLOWED-READ-WRITE", status: "pass" },
        { id: "DENIED-READ", status: "pass" },
        { id: "DENIED-WRITE", status: "pass" },
      ],
    });
  });

  it("passes when the denied credential is refused every operation", async () => {
    const db = new ReferenceDatabase();
    const refused = async () => {
      throw new Error("NOPERM");
    };
    const store = db.store("tenant-a/");
    const denied = Object.fromEntries(
      Object.entries(store).map(([name, value]) => [
        name,
        typeof value === "function" ? refused : value,
      ])
    ) as unknown as McpUseStorage;
    const report = await runStorageIsolationCheck({ allowed: store, denied });
    expect(report.passed).toBe(true);
  });

  it("fails when both stores share a prefix", async () => {
    const db = new ReferenceDatabase();
    const report = await runStorageIsolationCheck({
      allowed: db.store("shared/"),
      denied: db.store("shared/"),
    });
    expect(report.passed).toBe(false);
    expect(report.checks.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "ALLOWED-READ-WRITE", status: "pass" },
      { id: "DENIED-READ", status: "fail" },
      { id: "DENIED-WRITE", status: "fail" },
    ]);
    expect(report.checks[1]?.detail).toBe(
      "denied reads allowed's KV key, OAuth key, index, log"
    );
  });
});

describe("countingStorage", () => {
  it("counts each call once per operation, a batch as one", async () => {
    const counted = countingStorage(new ReferenceDatabase().store());
    await counted.logAppend("log", "a", {
      maxEvents: 10,
      dedupe: { key: "d", ttlMs: 1000 },
      mark: { index: "ix", member: "m", score: 1 },
    });
    await counted.logRange("log", { after: null, limit: 10 });
    await counted.logRange("log", { after: 1, limit: 10 });
    await counted.batch!([
      { op: "read", key: "a" },
      { op: "read", key: "b" },
    ]);
    await counted.signal!.publish("c", "m");
    expect(counted.counts()).toEqual({
      logAppend: 1,
      logRange: 2,
      batch: 1,
      "signal.publish": 1,
    });
    expect(counted.total()).toBe(5);
    counted.reset();
    expect(counted.counts()).toEqual({});
    expect(counted.total()).toBe(0);
  });

  it("keeps optional methods absent when the store lacks them", () => {
    const {
      readMany: _readMany,
      batch: _batch,
      signal: _signal,
      removePrefix: _removePrefix,
      ...store
    } = new ReferenceDatabase().store();
    const counted = countingStorage(store);
    expect(
      ["readMany", "batch", "signal", "removePrefix"].filter(
        (name) => name in counted
      )
    ).toEqual([]);
    const full = countingStorage(new ReferenceDatabase().store());
    expect(
      ["readMany", "batch", "signal", "removePrefix"].filter(
        (name) => name in full
      )
    ).toEqual(["readMany", "batch", "signal", "removePrefix"]);
    expect([full.kind, full.durable, full.shared]).toEqual([
      "reference",
      true,
      true,
    ]);
  });
});

describe("assertMcpUseStorage", () => {
  it("accepts a full McpUseStorage", () => {
    const store = new ReferenceDatabase().store();
    expect(isMcpUseStorage(store)).toBe(true);
    expect(() => assertMcpUseStorage(store)).not.toThrow();
  });

  it("rejects a Workers KV binding with STORAGE_UNSUPPORTED naming D1 and Durable Objects", () => {
    const kv = {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ keys: [] }),
      getWithMetadata: async () => ({ value: null, metadata: null }),
    };
    expect(isMcpUseStorage(kv)).toBe(false);
    let error: unknown;
    try {
      assertMcpUseStorage(kv);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "STORAGE_UNSUPPORTED" });
    expect((error as Error).message).toContain("D1");
    expect((error as Error).message).toContain("Durable Object");
  });

  it("rejects an OAuth-only store with STORAGE_UNSUPPORTED", () => {
    const oauthOnly = {
      get: async () => undefined,
      set: async () => undefined,
      delete: async () => undefined,
      take: async () => undefined,
      add: async () => true,
    };
    expect(() => assertMcpUseStorage(oauthOnly)).toThrow(
      expect.objectContaining({ code: "STORAGE_UNSUPPORTED" })
    );
  });
});
