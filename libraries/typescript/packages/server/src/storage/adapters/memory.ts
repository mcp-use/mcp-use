/**
 * In-process storage: `memoryStorage()` and the engine `fileStorage()`
 * persists.
 *
 * @packageDocumentation
 */
import type {
  IndexEntry,
  IndexRangePage,
  IndexRangeQuery,
  LogAppendOptions,
  LogAppendResult,
  LogRangeOptions,
  LogRangeResult,
  McpUseStorage,
  StorageSignal,
  Versioned,
} from "../types.js";
import { applyStoragePrefix, validateStoragePrefix } from "../prefix.js";

const MEMORY_STORAGE = Symbol.for("mcp-use.oauth.memoryStorage");

/** @internal One state change; the file adapter journals these. */
export type Mutation =
  | { t: "kv"; k: string; v: string; ver: number; exp: number | null }
  | { t: "kvdel"; k: string }
  | { t: "ix"; i: string; m: string; s: number }
  | { t: "ixdel"; i: string; m: string }
  | { t: "ixdrop"; i: string }
  | { t: "lhead"; s: string; e: string }
  | { t: "lpush"; s: string; q: number; v: string }
  | { t: "ltrim"; s: string; b: number }
  | { t: "ldel"; s: string };

interface KvEntry {
  value: string;
  version: number;
  expiresAt: number | null;
}

interface LogState {
  epoch: string;
  head: number;
  entries: Array<{ seq: number; value: string }>;
}

/** @internal A serializable snapshot of an engine. */
export interface EngineSnapshot {
  v: 1;
  version: number;
  kv: Array<[string, KvEntry]>;
  ix: Array<[string, Array<[string, number]>]>;
  logs: Array<[string, LogState]>;
}

/**
 * @internal The single-threaded store behind `memoryStorage` and
 * `fileStorage`. Every operation runs synchronously, so each one is atomic.
 * Every state change goes through {@link StorageEngine.apply}, which calls
 * `onMutation` so a persistence layer can journal it.
 */
export class StorageEngine {
  readonly kv = new Map<string, KvEntry>();
  readonly indexes = new Map<string, Map<string, number>>();
  readonly logs = new Map<string, LogState>();
  readonly #channels = new Map<string, Set<(message: string) => void>>();
  #version = 0;
  onMutation: ((mutation: Mutation) => void) | undefined;

  readonly now: () => number;

  /** Engine `constructor`: see the matching `McpUseStorage` method. */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Applies one mutation, journaling it first when a journal is attached. */
  apply(mutation: Mutation, journal = true): void {
    if (journal) this.onMutation?.(mutation);
    /** Engine `switch`: see the matching `McpUseStorage` method. */
    switch (mutation.t) {
      case "kv":
        this.kv.set(mutation.k, {
          value: mutation.v,
          version: mutation.ver,
          expiresAt: mutation.exp,
        });
        if (mutation.ver > this.#version) this.#version = mutation.ver;
        return;
      case "kvdel":
        this.kv.delete(mutation.k);
        return;
      case "ix": {
        let members = this.indexes.get(mutation.i);
        if (!members) {
          members = new Map();
          this.indexes.set(mutation.i, members);
        }
        members.set(mutation.m, mutation.s);
        return;
      }
      case "ixdel": {
        const members = this.indexes.get(mutation.i);
        members?.delete(mutation.m);
        if (members?.size === 0) this.indexes.delete(mutation.i);
        return;
      }
      case "ixdrop":
        this.indexes.delete(mutation.i);
        return;
      case "lhead":
        this.logs.set(mutation.s, { epoch: mutation.e, head: 0, entries: [] });
        return;
      case "lpush": {
        const log = this.logs.get(mutation.s);
        if (!log) return;
        log.head = mutation.q;
        log.entries.push({ seq: mutation.q, value: mutation.v });
        return;
      }
      case "ltrim": {
        const log = this.logs.get(mutation.s);
        if (!log) return;
        const index = log.entries.findIndex((e) => e.seq >= mutation.b);
        log.entries.splice(0, index === -1 ? log.entries.length : index);
        return;
      }
      case "ldel":
        this.logs.delete(mutation.s);
        return;
      default:
        throw new TypeError("Unknown storage mutation");
    }
  }

  /** Engine `snapshot`: see the matching `McpUseStorage` method. */
  snapshot(): EngineSnapshot {
    const now = this.now();
    return {
      v: 1,
      version: this.#version,
      kv: [...this.kv].filter(
        ([, entry]) => entry.expiresAt === null || entry.expiresAt > now
      ),
      ix: [...this.indexes].map(([name, members]) => [name, [...members]]),
      logs: [...this.logs],
    };
  }

  /** Engine `restore`: see the matching `McpUseStorage` method. */
  restore(snapshot: EngineSnapshot): void {
    this.#version = Math.max(this.#version, snapshot.version);
    for (const [key, entry] of snapshot.kv) this.kv.set(key, entry);
    for (const [name, members] of snapshot.ix) {
      this.indexes.set(name, new Map(members));
    }
    for (const [name, log] of snapshot.logs) this.logs.set(name, log);
  }

  #live(key: string): KvEntry | undefined {
    const entry = this.kv.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.kv.delete(key);
      return undefined;
    }
    return entry;
  }

  #put(key: string, value: string, ttlMs: number | undefined): string {
    const version = ++this.#version;
    this.apply({
      t: "kv",
      k: key,
      v: value,
      ver: version,
      exp: ttlMs === undefined ? null : this.now() + ttlMs,
    });
    return String(version);
  }

  /** Engine `read`: see the matching `McpUseStorage` method. */
  read(key: string): Versioned | undefined {
    const entry = this.#live(key);
    return entry && { value: entry.value, version: String(entry.version) };
  }

  /** Engine `write`: see the matching `McpUseStorage` method. */
  write(
    key: string,
    value: string,
    options: { ifVersion?: string | null; ttlMs?: number } = {}
  ): string | false {
    const current = this.#live(key);
    if (options.ifVersion === null && current) return false;
    if (
      typeof options.ifVersion === "string" &&
      (!current || String(current.version) !== options.ifVersion)
    ) {
      return false;
    }
    return this.#put(key, value, options.ttlMs);
  }

  /** Engine `remove`: see the matching `McpUseStorage` method. */
  remove(key: string, ifVersion?: string): boolean {
    const current = this.#live(key);
    if (!current) return false;
    if (ifVersion !== undefined && String(current.version) !== ifVersion) {
      return false;
    }
    this.apply({ t: "kvdel", k: key });
    return true;
  }

  /** Engine `take`: see the matching `McpUseStorage` method. */
  take(key: string): string | undefined {
    const current = this.#live(key);
    if (!current) return undefined;
    this.apply({ t: "kvdel", k: key });
    return current.value;
  }

  /** Engine `incr`: see the matching `McpUseStorage` method. */
  incr(key: string, ttlMs: number, by: number): number {
    const current = this.#live(key);
    const next = Number(current?.value ?? 0) + by;
    this.apply({
      t: "kv",
      k: key,
      v: String(next),
      ver: ++this.#version,
      exp: current ? current.expiresAt : this.now() + ttlMs,
    });
    return next;
  }

  /** Engine `indexAdd`: see the matching `McpUseStorage` method. */
  indexAdd(
    index: string,
    member: string,
    score: number,
    onlyIfAbsent?: boolean
  ): void {
    const members = this.indexes.get(index);
    if (onlyIfAbsent && members?.has(member)) return;
    if (members?.get(member) === score) return;
    this.apply({ t: "ix", i: index, m: member, s: score });
  }

  /** Engine `indexRemove`: see the matching `McpUseStorage` method. */
  indexRemove(index: string, member: string): void {
    if (this.indexes.get(index)?.has(member)) {
      this.apply({ t: "ixdel", i: index, m: member });
    }
  }

  #sorted(index: string, min?: number, max?: number): IndexEntry[] {
    const items: IndexEntry[] = [];
    for (const [member, score] of this.indexes.get(index) ?? []) {
      if (min !== undefined && score < min) continue;
      if (max !== undefined && score > max) continue;
      items.push({ member, score });
    }
    return items.sort(compareEntries);
  }

  /** Engine `indexRange`: see the matching `McpUseStorage` method. */
  indexRange(index: string, query: IndexRangeQuery): IndexRangePage {
    let all = this.#sorted(index, query.min, query.max);
    if (query.after !== undefined) {
      const cursor = decodeCursor(query.after);
      all = all.filter((entry) => compareEntries(entry, cursor) > 0);
    }
    const items = all.slice(0, Math.max(0, query.limit));
    const last = items[items.length - 1];
    return items.length < all.length && last
      ? { items, next: encodeCursor(last) }
      : { items };
  }

  /** Engine `indexCount`: see the matching `McpUseStorage` method. */
  indexCount(index: string, min?: number, max?: number): number {
    return this.#sorted(index, min, max).length;
  }

  /** Engine `logAppend`: see the matching `McpUseStorage` method. */
  logAppend(
    stream: string,
    value: string,
    options: LogAppendOptions,
    newEpoch: () => string
  ): LogAppendResult {
    if (options.dedupe) {
      const existing = this.#live(options.dedupe.key);
      if (existing) {
        const seq = Number(existing.value);
        return { duplicate: true, seq: Number.isFinite(seq) ? seq : null };
      }
    }
    let log = this.logs.get(stream);
    if (!log) {
      this.apply({ t: "lhead", s: stream, e: newEpoch() });
      log = this.logs.get(stream)!;
    }
    const seq = log.head + 1;
    this.apply({ t: "lpush", s: stream, q: seq, v: value });
    const max = Math.max(1, options.maxEvents);
    if (log.entries.length > max) {
      this.apply({ t: "ltrim", s: stream, b: seq - max + 1 });
    }
    if (options.dedupe) {
      this.#put(options.dedupe.key, String(seq), options.dedupe.ttlMs);
    }
    if (options.mark) {
      this.indexAdd(
        options.mark.index,
        options.mark.member,
        options.mark.score,
        true
      );
      if (options.notify !== undefined) {
        this.publish(options.notify, `${options.mark.member}:${seq}`);
      }
    }
    return { duplicate: false, seq, epoch: log.epoch };
  }

  /** Engine `logRange`: see the matching `McpUseStorage` method. */
  logRange(stream: string, options: LogRangeOptions): LogRangeResult {
    const log = this.logs.get(stream);
    if (!log) return { entries: [], epoch: null, first: 1, head: 0 };
    const after = options.after ?? 0;
    const entries: Array<{ seq: number; value: string }> = [];
    for (const entry of log.entries) {
      if (entries.length >= options.limit) break;
      if (entry.seq > after) entries.push({ ...entry });
    }
    return {
      entries,
      epoch: log.epoch,
      first: log.entries[0]?.seq ?? log.head + 1,
      head: log.head,
    };
  }

  /** Engine `logTrim`: see the matching `McpUseStorage` method. */
  logTrim(stream: string, before: number): number {
    const log = this.logs.get(stream);
    if (!log) return 0;
    const removed = log.entries.filter((entry) => entry.seq < before).length;
    if (removed > 0) this.apply({ t: "ltrim", s: stream, b: before });
    return removed;
  }

  /** Engine `logDelete`: see the matching `McpUseStorage` method. */
  logDelete(stream: string): void {
    if (this.logs.has(stream)) this.apply({ t: "ldel", s: stream });
  }

  /** Engine `removePrefix`: see the matching `McpUseStorage` method. */
  removePrefix(prefix: string): number {
    let removed = 0;
    for (const key of [...this.kv.keys()]) {
      if (key.startsWith(prefix) && this.#live(key)) {
        this.apply({ t: "kvdel", k: key });
        removed++;
      }
    }
    for (const index of [...this.indexes.keys()]) {
      if (index.startsWith(prefix)) {
        this.apply({ t: "ixdrop", i: index });
        removed++;
      }
    }
    for (const stream of [...this.logs.keys()]) {
      if (stream.startsWith(prefix)) {
        this.apply({ t: "ldel", s: stream });
        removed++;
      }
    }
    return removed;
  }

  /** Engine `publish`: see the matching `McpUseStorage` method. */
  publish(channel: string, message: string): void {
    for (const listener of [...(this.#channels.get(channel) ?? [])]) {
      try {
        listener(message);
      } catch {
        // A failing subscriber does not affect the publisher (lossy signal).
      }
    }
  }

  /** Engine `subscribe`: see the matching `McpUseStorage` method. */
  subscribe(channel: string, onMessage: (message: string) => void) {
    let listeners = this.#channels.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.#channels.set(channel, listeners);
    }
    // Wrap so the same callback can subscribe twice independently.
    const listener = (message: string) => onMessage(message);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#channels.delete(channel);
    };
  }
}

function compareEntries(a: IndexEntry, b: IndexEntry): number {
  if (a.score !== b.score) return a.score - b.score;
  return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
}

function encodeCursor(entry: IndexEntry): string {
  return JSON.stringify([entry.score, entry.member]);
}

function decodeCursor(cursor: string): IndexEntry {
  try {
    const [score, member] = JSON.parse(cursor) as [number, string];
    if (typeof score === "number" && typeof member === "string") {
      return { score, member };
    }
  } catch {
    // fall through
  }
  throw new TypeError(`Invalid indexRange cursor ${JSON.stringify(cursor)}`);
}

/** @internal A random 12-character `[a-z0-9]` epoch id (D49 cursor format). */
export function randomEpoch(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** @internal What an engine-backed store reports about itself. */
export interface EngineStoreInfo {
  kind: string;
  durable: boolean;
  shared: boolean;
  /** Runs after each operation that may have changed state. */
  afterWrite?: () => void;
}

/**
 * @internal Exposes an engine as an `McpUseStorage`. Every method runs the
 * engine synchronously inside its promise.
 */
export function engineStorage(
  engine: StorageEngine,
  info: EngineStoreInfo
): McpUseStorage {
  const run = <T>(fn: () => T, writes = true): Promise<T> => {
    try {
      const result = fn();
      if (writes) info.afterWrite?.();
      return Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const ttlMs = (seconds: number) => seconds * 1000;
  const signal: StorageSignal = {
    publish: (channel, message) =>
      run(() => engine.publish(channel, message), false),
    subscribe: (channel, onMessage) =>
      run(() => {
        const off = engine.subscribe(channel, onMessage);
        return async () => off();
      }, false),
  };
  return {
    kind: info.kind,
    durable: info.durable,
    shared: info.shared,
    capabilities: { signal: true, batch: false },
    get: (key) => run(() => engine.read(key)?.value, false),
    set: (key, value, ttlSeconds) =>
      run(() => {
        engine.write(key, value, { ttlMs: ttlMs(ttlSeconds) });
      }),
    delete: (key) =>
      run(() => {
        engine.remove(key);
      }),
    take: (key) => run(() => engine.take(key)),
    add: (key, value, ttlSeconds) =>
      run(
        () =>
          engine.write(key, value, {
            ifVersion: null,
            ttlMs: ttlMs(ttlSeconds),
          }) !== false
      ),
    read: (key) => run(() => engine.read(key), false),
    readMany: (keys) => run(() => keys.map((key) => engine.read(key)), false),
    write: (key, value, options) =>
      run(() => engine.write(key, value, options)),
    remove: (key, options) => run(() => engine.remove(key, options?.ifVersion)),
    incr: (key, options) =>
      run(() => engine.incr(key, options.ttlMs, options.by ?? 1)),
    indexAdd: (index, member, score, options) =>
      run(() => engine.indexAdd(index, member, score, options?.onlyIfAbsent)),
    indexRemove: (index, member) =>
      run(() => engine.indexRemove(index, member)),
    indexRange: (index, query) =>
      run(() => engine.indexRange(index, query), false),
    indexCount: (index, query) =>
      run(() => engine.indexCount(index, query?.min, query?.max), false),
    logAppend: (stream, value, options) =>
      run(() => engine.logAppend(stream, value, options, randomEpoch)),
    logRange: (stream, options) =>
      run(() => engine.logRange(stream, options), false),
    logTrim: (stream, options) =>
      run(() => engine.logTrim(stream, options.before)),
    logDelete: (stream) => run(() => engine.logDelete(stream)),
    signal,
    removePrefix: (prefix) => run(() => engine.removePrefix(prefix)),
  };
}

/** Options for {@link memoryStorage}. */
export interface MemoryStorageOptions {
  /**
   * Prepended to every key the store writes. Must not contain `{` or `}`.
   *
   * @defaultValue `""`
   */
  prefix?: string;
}

/**
 * Creates an in-process store for local development and tests.
 *
 * Each call returns a new, empty store. Its state is lost on restart and is
 * not shared between instances (`durable: false`, `shared: false`), so
 * `oauthProxy` accepts it only when the MCP resource is on localhost, and a
 * restart starts every Events log in a new epoch. It implements the full
 * `McpUseStorage` contract, including an in-process `signal`.
 *
 * @param options - Key prefix.
 * @returns A store that keeps values in memory.
 *
 * @example
 * ```ts
 * import { memoryStorage } from "mcp-use/storage";
 *
 * const storage = memoryStorage();
 * ```
 */
export function memoryStorage(options?: MemoryStorageOptions): McpUseStorage {
  const prefix = validateStoragePrefix(options?.prefix, "memoryStorage");
  const engine = new StorageEngine();
  const storage = applyStoragePrefix(
    engineStorage(engine, { kind: "memory", durable: false, shared: false }),
    prefix
  );
  // Marks the store for `isMemoryStorage` in `oauthProxy`.
  Object.defineProperty(storage, MEMORY_STORAGE, { value: true });
  return storage;
}
