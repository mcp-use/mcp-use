/**
 * `runStorageConformance`: the checks every `McpUseStorage` adapter passes,
 * first-party or third-party.
 *
 * @packageDocumentation
 */
import type { McpUseStorage, StorageOp } from "./types.js";

/** Identifier of one conformance check. */
export type StorageCheckId =
  | "CAS"
  | "INCR"
  | "INDEX"
  | "TTL"
  | "PREFIX"
  | "LOG-SEQ"
  | "LOG-DEDUPE"
  | "LOG-DEDUPE-TTL"
  | "LOG-MARK"
  | "LOG-ATOMIC"
  | "LOG-RANGE"
  | "LOG-CAP"
  | "LOG-TRIM"
  | "LOG-EPOCH"
  | "SIGNAL"
  | "BATCH"
  | "REMOVE-PREFIX";

/** Every check, in the order {@link runStorageConformance} runs them. */
export const STORAGE_CHECK_IDS: readonly StorageCheckId[] = [
  "CAS",
  "INCR",
  "INDEX",
  "TTL",
  "PREFIX",
  "LOG-SEQ",
  "LOG-DEDUPE",
  "LOG-DEDUPE-TTL",
  "LOG-MARK",
  "LOG-ATOMIC",
  "LOG-RANGE",
  "LOG-CAP",
  "LOG-TRIM",
  "LOG-EPOCH",
  "SIGNAL",
  "BATCH",
  "REMOVE-PREFIX",
];

/** Outcome of one check. */
export interface StorageCheckResult {
  /** The check. */
  id: StorageCheckId;
  /**
   * `pass`; `fail`; `skip` when the store lacks the optional feature or the
   * options needed to run it; `manual` for a reviewer checklist item that
   * cannot be observed through the API (`LOG-ATOMIC`).
   */
  status: "pass" | "fail" | "skip" | "manual";
  /** Why the check failed, was skipped, or what the reviewer must confirm. */
  detail?: string;
}

/** Result of {@link runStorageConformance}. */
export interface StorageConformanceReport {
  /** `kind` of the store under test. */
  kind: string;
  /** `true` when no check failed. */
  passed: boolean;
  /** One result per check, in {@link STORAGE_CHECK_IDS} order. */
  checks: StorageCheckResult[];
}

/** Options for {@link runStorageConformance}. */
export interface StorageConformanceOptions {
  /**
   * Opens another client of the same database with the given prefix.
   * Needed for `PREFIX`, for four-client `LOG-SEQ`, and for the restart part
   * of `LOG-EPOCH` on durable stores. Prefixes passed here start with
   * {@link StorageConformanceOptions.prefix}, so a credential scoped to that
   * prefix suffices.
   */
  open?: (prefix: string) => McpUseStorage | Promise<McpUseStorage>;
  /**
   * The prefix the store under test was created with.
   *
   * @defaultValue `""`
   */
  prefix?: string;
  /** Run only these checks; the others are reported as `skip`. */
  only?: readonly StorageCheckId[];
  /**
   * Expiry used by the `TTL` and `LOG-DEDUPE-TTL` checks, in milliseconds.
   *
   * @defaultValue `1000`
   */
  ttlMs?: number;
  /**
   * Lets time pass, for stores with an injected clock. Real stores leave it
   * unset and the suite waits in real time.
   */
  advanceTime?: (ms: number) => void | Promise<void>;
}

class CheckFailure extends Error {}

class CheckSkipped extends Error {}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

function same(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${what}: expected ${e}, got ${a}`);
}

const LONG_TTL_MS = 10 * 60 * 1000;

interface Context {
  storage: McpUseStorage;
  key: (name: string) => string;
  open?: (relativePrefix: string) => Promise<McpUseStorage>;
  ttlMs: number;
  wait: (ms: number) => Promise<void>;
  runId: string;
}

type Check = (ctx: Context) => Promise<void | string>;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs the storage conformance checks against a store and reports each
 * outcome; it does not throw on failure. Checks use keys under a random
 * `mcp-use-conformance:{<run>}:` namespace (one Redis Cluster hash tag) and
 * remove what they wrote afterwards, so the suite can run against a shared
 * database.
 *
 * @param storage - The store under test.
 * @param options - Extra clients, prefix, check selection and clock.
 * @returns One result per check.
 *
 * @example
 * ```ts
 * const report = await runStorageConformance(store, {
 *   open: (prefix) => myStorage({ url, prefix }),
 * });
 * expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
 * ```
 */
export async function runStorageConformance(
  storage: McpUseStorage,
  options: StorageConformanceOptions = {}
): Promise<StorageConformanceReport> {
  const runId = randomId();
  const basePrefix = options.prefix ?? "";
  const tracked: TrackedStore[] = [];
  const track = (store: McpUseStorage) => {
    const entry = trackStore(store);
    tracked.push(entry);
    return entry.store;
  };
  const advance = options.advanceTime;
  const openFn = options.open;
  const ctx: Context = {
    storage: track(storage),
    key: (name) => `mcp-use-conformance:{${runId}}:${name}`,
    ...(openFn && {
      open: async (relativePrefix: string) =>
        track(await openFn(basePrefix + relativePrefix)),
    }),
    ttlMs: options.ttlMs ?? 1000,
    wait: advance ? async (ms) => advance(ms) : sleep,
    runId,
  };
  const checks: StorageCheckResult[] = [];
  for (const id of STORAGE_CHECK_IDS) {
    if (options.only && !options.only.includes(id)) {
      checks.push({ id, status: "skip", detail: "not selected" });
      continue;
    }
    if (id === "LOG-ATOMIC") {
      checks.push({
        id,
        status: "manual",
        detail:
          "Reviewer item: logAppend runs as one script, one transaction or one Durable Object call, so no failure can stop it between steps.",
      });
      continue;
    }
    try {
      const note = await CHECKS[id](ctx);
      checks.push({ id, status: "pass", ...(note && { detail: note }) });
    } catch (error) {
      checks.push(
        error instanceof CheckSkipped
          ? { id, status: "skip", detail: error.message }
          : {
              id,
              status: "fail",
              detail:
                error instanceof CheckFailure
                  ? error.message
                  : `threw: ${error instanceof Error ? error.message : String(error)}`,
            }
      );
    }
  }
  for (const entry of tracked) await entry.cleanup();
  return {
    kind: storage.kind,
    passed: checks.every((result) => result.status !== "fail"),
    checks,
  };
}

const CHECKS: Record<Exclude<StorageCheckId, "LOG-ATOMIC">, Check> = {
  async CAS({ storage, key }) {
    const k = key("cas");
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        storage.write(k, `v${i}`, { ifVersion: null, ttlMs: LONG_TTL_MS })
      )
    );
    const winners = created.flatMap((version, i) =>
      typeof version === "string" ? [{ version, i }] : []
    );
    same(winners.length, 1, "concurrent writes with ifVersion: null that won");
    check(
      created.every((v) => v === false || typeof v === "string"),
      "write returns a version string or false"
    );
    const winner = winners[0]!;
    const first = await storage.read(k);
    same(first, { value: `v${winner.i}`, version: winner.version }, "read");
    const second = await storage.write(k, "next", {
      ifVersion: winner.version,
      ttlMs: LONG_TTL_MS,
    });
    check(typeof second === "string", "write with the current version wins");
    check(second !== winner.version, "the version changes on every write");
    same(
      await storage.write(k, "stale", { ifVersion: winner.version }),
      false,
      "write with a stale version"
    );
    same((await storage.read(k))?.value, "next", "value after a stale write");
    const race = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        storage.write(k, `c${i}`, { ifVersion: second, ttlMs: LONG_TTL_MS })
      )
    );
    same(
      race.filter((v) => typeof v === "string").length,
      1,
      "concurrent writes with the same ifVersion that won"
    );
    const plain = await storage.write(k, "plain", { ttlMs: LONG_TTL_MS });
    check(
      typeof plain === "string",
      "an unconditional write returns a version"
    );
    check(
      !race.includes(plain),
      "an unconditional write returns a new version"
    );
    same(
      await storage.write(key("cas-absent"), "x", { ifVersion: plain }),
      false,
      "write with a version to an absent key"
    );
    same(await storage.read(key("cas-absent")), undefined, "absent key");
    same(
      await storage.remove(k, { ifVersion: second }),
      false,
      "remove with a stale version"
    );
    same(
      await storage.remove(k, { ifVersion: plain }),
      true,
      "remove with the current version"
    );
    same(await storage.read(k), undefined, "read after remove");
    same(await storage.remove(k), false, "remove of an absent key");
    if (storage.readMany) {
      const a = key("cas-many-a");
      const b = key("cas-many-b");
      await storage.write(a, "A", { ttlMs: LONG_TTL_MS });
      await storage.write(b, "B", { ttlMs: LONG_TTL_MS });
      const many = await storage.readMany([a, key("cas-many-none"), b]);
      same(
        many.map((entry) => entry?.value),
        ["A", undefined, "B"],
        "readMany values in order"
      );
    }
  },

  async INCR({ storage, key }) {
    const c = key("incr");
    const values = await Promise.all(
      Array.from({ length: 50 }, () => storage.incr(c, { ttlMs: LONG_TTL_MS }))
    );
    same(
      [...values].sort((x, y) => x - y),
      Array.from({ length: 50 }, (_, i) => i + 1),
      "values of 50 concurrent increments"
    );
    same(
      await storage.incr(c, { ttlMs: LONG_TTL_MS, by: 5 }),
      55,
      "increment by 5"
    );
  },

  async INDEX({ storage, key }) {
    const ix = key("index");
    await storage.indexAdd(ix, "b", 2);
    await storage.indexAdd(ix, "a", 2);
    await storage.indexAdd(ix, "c", 1);
    await storage.indexAdd(ix, "d", 1_700_000_000_000);
    await storage.indexAdd(ix, "ab", 2);
    await storage.indexAdd(ix, "c", 5, { onlyIfAbsent: true });
    await storage.indexAdd(ix, "e", 3, { onlyIfAbsent: true });
    await storage.indexAdd(ix, "a", 4);
    const expected = [
      { member: "c", score: 1 },
      { member: "ab", score: 2 },
      { member: "b", score: 2 },
      { member: "e", score: 3 },
      { member: "a", score: 4 },
      { member: "d", score: 1_700_000_000_000 },
    ];
    const all = await storage.indexRange(ix, { limit: 100 });
    same(all.items, expected, "indexRange order by (score, member)");
    const paged: unknown[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await storage.indexRange(ix, {
        limit: 2,
        ...(after !== undefined && { after }),
      });
      paged.push(...result.items);
      if (result.next === undefined) break;
      after = result.next;
    }
    same(paged, expected, "pages of 2 joined");
    same(
      (await storage.indexRange(ix, { min: 2, max: 4, limit: 10 })).items,
      expected.slice(1, 5),
      "indexRange with inclusive min 2 and max 4"
    );
    same(
      (await storage.indexRange(ix, { min: 2, max: 4, limit: 2 })).items,
      expected.slice(1, 3),
      "indexRange with min, max and limit"
    );
    same(await storage.indexCount(ix), 6, "indexCount");
    same(
      await storage.indexCount(ix, { min: 2, max: 4 }),
      4,
      "indexCount 2..4"
    );
    await storage.indexRemove(ix, "e");
    await storage.indexRemove(ix, "absent");
    same(await storage.indexCount(ix), 5, "indexCount after indexRemove");
    const empty = await storage.indexRange(key("index-empty"), { limit: 5 });
    same(empty.items, [], "indexRange of an empty index");
    same(empty.next, undefined, "next of an empty index");
    same(
      await storage.indexCount(key("index-empty")),
      0,
      "indexCount of empty"
    );
  },

  async TTL({ storage, key, ttlMs, wait }) {
    const k = key("ttl");
    const kept = key("ttl-cleared");
    const c = key("ttl-counter");
    await storage.write(k, "v", { ttlMs });
    await storage.write(kept, "v", { ttlMs });
    await storage.write(kept, "v2");
    same(await storage.incr(c, { ttlMs }), 1, "first increment");
    await wait(Math.round(ttlMs * 0.6));
    same(await storage.incr(c, { ttlMs }), 2, "second increment");
    same((await storage.read(k))?.value, "v", "value before its ttl");
    await wait(Math.round(ttlMs * 0.6));
    same(await storage.read(k), undefined, "value after its ttl");
    same(
      (await storage.read(kept))?.value,
      "v2",
      "a value rewritten without ttlMs does not expire"
    );
    same(
      await storage.incr(c, { ttlMs }),
      1,
      "counter after the ttl of its first increment"
    );
  },

  async PREFIX({ key, open, runId }) {
    if (!open) throw new CheckSkipped("needs options.open");
    const aRel = `cfa${runId}/`;
    const a = await open(aRel);
    const b = await open(`cfb${runId}/`);
    const raw = await open("");
    const k = key("prefix-kv");
    const o = key("prefix-oauth");
    const c = key("prefix-counter");
    const ix = key("prefix-index");
    const mx = key("prefix-mark");
    const s = key("prefix-log");
    const d = key("prefix-dedupe");
    await a.write(k, "a", { ttlMs: LONG_TTL_MS });
    await a.set(o, "a", 600);
    await a.incr(c, { ttlMs: LONG_TTL_MS });
    await a.indexAdd(ix, "m", 1);
    await a.logAppend(s, "a", {
      maxEvents: 10,
      dedupe: { key: d, ttlMs: LONG_TTL_MS },
      mark: { index: mx, member: "m", score: 1 },
    });
    same((await raw.read(aRel + k))?.value, "a", "KV key under the prefix");
    same(await raw.get(aRel + o), "a", "OAuth key under the prefix");
    same(
      await raw.incr(aRel + c, { ttlMs: LONG_TTL_MS, by: 0 }),
      1,
      "counter under the prefix"
    );
    same(await raw.indexCount(aRel + ix), 1, "index under the prefix");
    same(await raw.indexCount(aRel + mx), 1, "mark index under the prefix");
    same(
      (await raw.logRange(aRel + s, { after: null, limit: 0 })).head,
      1,
      "log under the prefix"
    );
    same(
      (
        await raw.logAppend(aRel + s, "raw", {
          maxEvents: 10,
          dedupe: { key: aRel + d, ttlMs: LONG_TTL_MS },
        })
      ).duplicate,
      true,
      "dedupe key under the prefix"
    );
    same(await raw.read(k), undefined, "KV key without the prefix");
    same(await b.read(k), undefined, "KV key from another prefix");
    same(await b.get(o), undefined, "OAuth key from another prefix");
    same(await b.indexCount(ix), 0, "index from another prefix");
    same(
      (await b.logRange(s, { after: null, limit: 0 })).head,
      0,
      "log from another prefix"
    );
    same(
      await b.incr(c, { ttlMs: LONG_TTL_MS }),
      1,
      "counter from another prefix"
    );
    same(
      (
        await b.logAppend(s, "b", {
          maxEvents: 10,
          dedupe: { key: d, ttlMs: LONG_TTL_MS },
        })
      ).duplicate,
      false,
      "dedupe key from another prefix"
    );
  },

  async "LOG-SEQ"({ storage, key, open }) {
    const clients = open
      ? [storage, await open(""), await open(""), await open("")]
      : [storage, storage, storage, storage];
    const s = key("log-seq");
    const results = await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        clients[i % 4]!.logAppend(s, `e${i}`, { maxEvents: 2000 })
      )
    );
    const seqs = results.map((result) => result.seq);
    check(
      results.every((result) => !result.duplicate),
      "no append is a duplicate"
    );
    same(
      [...seqs].sort((x, y) => (x ?? 0) - (y ?? 0)),
      Array.from({ length: 1000 }, (_, i) => i + 1),
      "seqs of 1,000 concurrent appends"
    );
    const epochs = new Set(
      results.map((result) => (result.duplicate ? null : result.epoch))
    );
    same(epochs.size, 1, "distinct epochs");
    const range = await storage.logRange(s, { after: null, limit: 1000 });
    same(range.head, 1000, "head");
    same(range.entries.length, 1000, "entries");
    return open ? undefined : "one client: options.open not given";
  },

  async "LOG-DEDUPE"({ storage, key }) {
    const s = key("log-dedupe");
    const d = key("log-dedupe-key");
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        storage.logAppend(s, `d${i}`, {
          maxEvents: 100,
          dedupe: { key: d, ttlMs: LONG_TTL_MS },
        })
      )
    );
    const fresh = results.filter((result) => !result.duplicate);
    same(fresh.length, 1, "appends that were not duplicates");
    const seq = fresh[0]!.seq;
    same(
      results.filter((result) => result.duplicate && result.seq !== seq).length,
      0,
      "duplicates that returned another seq"
    );
    const range = await storage.logRange(s, { after: null, limit: 100 });
    same(range.head, 1, "head");
    same(range.entries.length, 1, "entries");
  },

  async "LOG-DEDUPE-TTL"({ storage, key, ttlMs, wait }) {
    const s = key("log-dedupe-ttl");
    const dedupe = { key: key("log-dedupe-ttl-key"), ttlMs };
    const first = await storage.logAppend(s, "a", { maxEvents: 10, dedupe });
    same([first.duplicate, first.seq], [false, 1], "first append");
    const again = await storage.logAppend(s, "b", { maxEvents: 10, dedupe });
    same([again.duplicate, again.seq], [true, 1], "append within the ttl");
    await wait(Math.round(ttlMs * 1.2));
    const later = await storage.logAppend(s, "c", { maxEvents: 10, dedupe });
    same([later.duplicate, later.seq], [false, 2], "append after the ttl");
  },

  async "LOG-MARK"({ storage, key }) {
    const s = key("log-mark");
    const ix = key("log-mark-index");
    const d = key("log-mark-dedupe");
    await storage.logAppend(s, "a", {
      maxEvents: 10,
      mark: { index: ix, member: "m", score: 5 },
    });
    await storage.logAppend(s, "b", {
      maxEvents: 10,
      mark: { index: ix, member: "m", score: 9 },
    });
    same(
      (await storage.indexRange(ix, { limit: 10 })).items,
      [{ member: "m", score: 5 }],
      "mark keeps its first score"
    );
    await storage.logAppend(s, "c", {
      maxEvents: 10,
      dedupe: { key: d, ttlMs: LONG_TTL_MS },
      mark: { index: ix, member: "x", score: 1 },
    });
    const duplicate = await storage.logAppend(s, "d", {
      maxEvents: 10,
      dedupe: { key: d, ttlMs: LONG_TTL_MS },
      mark: { index: ix, member: "n", score: 2 },
    });
    same(duplicate.duplicate, true, "duplicate append");
    same(
      (await storage.indexRange(ix, { limit: 10 })).items,
      [
        { member: "x", score: 1 },
        { member: "m", score: 5 },
      ],
      "marks after a duplicate append"
    );
  },

  async "LOG-RANGE"({ storage, key }) {
    const s = key("log-range");
    same(
      await storage.logRange(s, { after: null, limit: 10 }),
      { entries: [], epoch: null, first: 1, head: 0 },
      "range of a log never written"
    );
    let epoch = "";
    for (let i = 1; i <= 5; i++) {
      const result = await storage.logAppend(s, `v${i}`, { maxEvents: 100 });
      if (!result.duplicate) epoch = result.epoch;
    }
    same(
      await storage.logRange(s, { after: 2, limit: 2 }),
      {
        entries: [
          { seq: 3, value: "v3" },
          { seq: 4, value: "v4" },
        ],
        epoch,
        first: 1,
        head: 5,
      },
      "after 2, limit 2"
    );
    same(
      await storage.logRange(s, { after: 3, limit: 0 }),
      { entries: [], epoch, first: 1, head: 5 },
      "limit 0"
    );
    same(
      (await storage.logRange(s, { after: null, limit: 10 })).entries.map(
        (entry) => entry.seq
      ),
      [1, 2, 3, 4, 5],
      "after null"
    );
    same(
      (await storage.logRange(s, { after: 5, limit: 10 })).entries,
      [],
      "after head"
    );
    await storage.logTrim(s, { before: 6 });
    same(
      await storage.logRange(s, { after: null, limit: 10 }),
      { entries: [], epoch, first: 6, head: 5 },
      "range of a trimmed-empty log"
    );
  },

  async "LOG-CAP"({ storage, key }) {
    const s = key("log-cap");
    for (let i = 1; i <= 100; i++) {
      await storage.logAppend(s, `v${i}`, { maxEvents: 20 });
    }
    const range = await storage.logRange(s, { after: null, limit: 1000 });
    const seqs = range.entries.map((entry) => entry.seq);
    check(
      seqs.length >= 20 && seqs.length <= 22,
      `entries kept with maxEvents 20: expected 20 to 22, got ${seqs.length}`
    );
    same(
      seqs,
      Array.from({ length: seqs.length }, (_, i) => 101 - seqs.length + i),
      "the newest entries are kept"
    );
    same([range.first, range.head], [seqs[0], 100], "first and head");
  },

  async "LOG-TRIM"({ storage, key }) {
    const s = key("log-trim");
    for (let i = 1; i <= 10; i++) {
      await storage.logAppend(s, `v${i}`, { maxEvents: 100 });
    }
    same(await storage.logTrim(s, { before: 4 }), 3, "entries trimmed");
    const range = await storage.logRange(s, { after: null, limit: 100 });
    same(
      range.entries.map((entry) => entry.seq),
      [4, 5, 6, 7, 8, 9, 10],
      "entries after trimming before 4"
    );
    same([range.first, range.head], [4, 10], "first and head");
    same(await storage.logTrim(s, { before: 4 }), 0, "trimming again");
    same(await storage.logTrim(s, { before: 1 }), 0, "trimming before 1");
  },

  async "LOG-EPOCH"({ storage, key, open }) {
    const s = key("log-epoch");
    const first = await storage.logAppend(s, "a", { maxEvents: 10 });
    check(!first.duplicate, "first append is not a duplicate");
    check(
      typeof first.epoch === "string" && /^[a-z0-9]{12}$/.test(first.epoch),
      "the epoch is a 12-character [a-z0-9] id (cursors embed it)"
    );
    same(first.seq, 1, "first seq");
    const second = await storage.logAppend(s, "b", { maxEvents: 10 });
    same(
      second.duplicate ? null : [second.seq, second.epoch],
      [2, first.epoch],
      "second append"
    );
    same(
      (await storage.logRange(s, { after: null, limit: 0 })).epoch,
      first.epoch,
      "epoch from logRange"
    );
    let note: string | undefined;
    if (storage.durable && open) {
      const reopened = await open("");
      same(
        (await reopened.logRange(s, { after: null, limit: 0 })).epoch,
        first.epoch,
        "epoch seen by a newly opened client"
      );
    } else if (storage.durable) {
      note = "restart not checked: options.open not given";
    }
    await storage.logDelete(s);
    same(
      await storage.logRange(s, { after: null, limit: 10 }),
      { entries: [], epoch: null, first: 1, head: 0 },
      "range after logDelete"
    );
    const third = await storage.logAppend(s, "c", { maxEvents: 10 });
    check(!third.duplicate, "append after logDelete is not a duplicate");
    same(third.seq, 1, "seq after logDelete");
    check(third.epoch !== first.epoch, "logDelete then append mints an epoch");
    return note;
  },

  async SIGNAL({ storage, key }) {
    if (!storage.capabilities.signal) {
      throw new CheckSkipped("capabilities.signal is false");
    }
    const signal = storage.signal;
    check(
      signal !== undefined,
      "capabilities.signal is true but signal is absent"
    );
    const channel = key("signal");
    const received: string[] = [];
    const unsubscribe = await signal.subscribe(channel, (message) => {
      received.push(message);
    });
    try {
      await signal.publish(channel, "hello");
      check(
        await arrives(received, "hello", 1000),
        "a published message arrives within 1 s"
      );
      const appended = await storage.logAppend(key("signal-log"), "x", {
        maxEvents: 10,
        mark: { index: key("signal-index"), member: "mm", score: 1 },
        notify: channel,
      });
      check(
        await arrives(received, `mm:${appended.seq}`, 1000),
        "logAppend publishes {mark.member}:{seq} on notify within 1 s"
      );
    } finally {
      await unsubscribe();
    }
    await signal.publish(channel, "after");
    await sleep(200);
    check(
      !received.includes("after"),
      "no message arrives after unsubscribing"
    );
  },

  async BATCH({ storage, key }) {
    if (!storage.capabilities.batch) {
      throw new CheckSkipped("capabilities.batch is false");
    }
    check(
      typeof storage.batch === "function",
      "capabilities.batch is true but batch is absent"
    );
    const k = key("batch");
    const ix = key("batch-index");
    const ops: StorageOp[] = [
      { op: "write", key: k, value: "one", ttlMs: LONG_TTL_MS },
      { op: "read", key: k },
      { op: "write", key: k, value: "two", ifVersion: "stale-version" },
      { op: "indexAdd", index: ix, member: "m", score: 1 },
      { op: "indexRange", index: ix, limit: 10 },
      { op: "remove", key: key("batch-absent") },
      { op: "read", key: k },
      { op: "indexRemove", index: ix, member: "m" },
    ];
    const results = await storage.batch(ops);
    same(results.length, ops.length, "result count");
    const version = results[0];
    check(typeof version === "string", "write result is a version");
    same(results[1], { value: "one", version }, "read result");
    same(results[2], false, "stale write result");
    check(results[3] == null, "indexAdd result is empty");
    same(
      (results[4] as { items?: unknown } | undefined)?.items,
      [{ member: "m", score: 1 }],
      "indexRange result"
    );
    same(results[5], false, "remove of an absent key");
    same(results[6], { value: "one", version }, "read after the failed write");
    same(await storage.indexCount(ix), 0, "indexRemove applied");
  },

  async "REMOVE-PREFIX"({ storage, key }) {
    if (!storage.removePrefix) throw new CheckSkipped("removePrefix is absent");
    const under = key("rp/");
    const outside = key("rp-outside");
    for (const name of ["a", "b", "c"]) {
      await storage.write(under + name, name, { ttlMs: LONG_TTL_MS });
    }
    await storage.write(outside, "o", { ttlMs: LONG_TTL_MS });
    same(await storage.removePrefix(under), 3, "keys removed");
    same(
      await Promise.all(
        ["a", "b", "c"].map(async (name) => storage.read(under + name))
      ),
      [undefined, undefined, undefined],
      "keys under the prefix"
    );
    same((await storage.read(outside))?.value, "o", "key outside the prefix");
  },
};

async function arrives(
  received: string[],
  message: string,
  withinMs: number
): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (!received.includes(message)) {
    if (Date.now() >= deadline) return false;
    await sleep(10);
  }
  return true;
}

function randomId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

interface TrackedStore {
  store: McpUseStorage;
  cleanup(): Promise<void>;
}

const KEY_METHODS = new Set([
  "get",
  "set",
  "delete",
  "take",
  "add",
  "read",
  "write",
  "remove",
  "incr",
]);
const INDEX_METHODS = new Set([
  "indexAdd",
  "indexRemove",
  "indexRange",
  "indexCount",
]);
const LOG_METHODS = new Set(["logAppend", "logRange", "logTrim", "logDelete"]);

/** Records what a check touches, so it can be removed afterwards. */
function trackStore(storage: McpUseStorage): TrackedStore {
  const keys = new Set<string>();
  const indexes = new Set<string>();
  const streams = new Set<string>();
  const recordOp = (op: StorageOp) => {
    if ("key" in op) keys.add(op.key);
    else indexes.add(op.index);
  };
  const store = new Proxy(storage, {
    // Getters run against the store itself, not the proxy, so a class
    // whose getters read `#private` fields still works.
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof property !== "string" || typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]): unknown => {
        const first = args[0];
        if (KEY_METHODS.has(property) && typeof first === "string") {
          keys.add(first);
        } else if (INDEX_METHODS.has(property) && typeof first === "string") {
          indexes.add(first);
        } else if (LOG_METHODS.has(property) && typeof first === "string") {
          streams.add(first);
          const options = args[2] as
            | { dedupe?: { key: string }; mark?: { index: string } }
            | undefined;
          if (property === "logAppend" && options) {
            if (options.dedupe) keys.add(options.dedupe.key);
            if (options.mark) indexes.add(options.mark.index);
          }
        } else if (property === "readMany" && Array.isArray(first)) {
          for (const k of first as string[]) keys.add(k);
        } else if (property === "batch" && Array.isArray(first)) {
          for (const op of first as StorageOp[]) recordOp(op);
        }
        return (value as (...values: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const quietly = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch {
      // Best effort: the check already reported its outcome.
    }
  };
  return {
    store,
    async cleanup() {
      for (const stream of streams) {
        await quietly(() => storage.logDelete(stream));
      }
      for (const index of indexes) {
        await quietly(async () => {
          for (let round = 0; round < 100; round++) {
            const page = await storage.indexRange(index, { limit: 100 });
            if (page.items.length === 0) break;
            for (const item of page.items) {
              await storage.indexRemove(index, item.member);
            }
          }
        });
      }
      for (const key of keys) {
        await quietly(() => storage.remove(key));
        await quietly(() => storage.delete(key));
      }
    },
  };
}
