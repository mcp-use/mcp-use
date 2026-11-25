/**
 * A small in-test McpUseStorage that the conformance suite is validated
 * against. One `ReferenceDatabase` is "the database"; `store(prefix)` opens a
 * client of it with a key prefix, like an adapter factory would. Every
 * operation runs synchronously inside its promise, so each is atomic.
 */
import { applyStoragePrefix } from "../../src/storage/prefix.js";
import type {
  IndexEntry,
  McpUseStorage,
  StorageOp,
  Versioned,
} from "../../src/storage/types.js";

interface Value {
  value: string;
  version: number;
  expiresAt: number | undefined;
}

interface Log {
  head: { epoch: string; seq: number } | undefined;
  entries: Array<{ seq: number; value: string }>;
}

export class ReferenceDatabase {
  now = 0;
  readonly values = new Map<string, Value>();
  readonly indexes = new Map<string, Map<string, number>>();
  readonly logs = new Map<string, Log>();
  readonly channels = new Map<string, Set<(message: string) => void>>();
  #version = 0;
  #epoch = 0;

  /** Opens a client of this database whose keys all start with `prefix`. */
  store(prefix = ""): McpUseStorage {
    return applyStoragePrefix(this.#client(), prefix);
  }

  #live(key: string): Value | undefined {
    const entry = this.values.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.now) {
      this.values.delete(key);
      return undefined;
    }
    return entry;
  }

  #put(key: string, value: string, ttlMs: number | undefined): string {
    const version = ++this.#version;
    this.values.set(key, {
      value,
      version,
      expiresAt: ttlMs === undefined ? undefined : this.now + ttlMs,
    });
    return String(version);
  }

  #read(key: string): Versioned | undefined {
    const entry = this.#live(key);
    return entry && { value: entry.value, version: String(entry.version) };
  }

  #write(
    key: string,
    value: string,
    options: { ifVersion?: string | null; ttlMs?: number } = {}
  ): string | false {
    const current = this.#live(key);
    if (options.ifVersion === null && current) return false;
    if (
      typeof options.ifVersion === "string" &&
      String(current?.version) !== options.ifVersion
    ) {
      return false;
    }
    return this.#put(key, value, options.ttlMs);
  }

  #remove(key: string, options: { ifVersion?: string } = {}): boolean {
    const current = this.#live(key);
    if (!current) return false;
    if (
      options.ifVersion !== undefined &&
      String(current.version) !== options.ifVersion
    ) {
      return false;
    }
    this.values.delete(key);
    return true;
  }

  #indexAdd(
    index: string,
    member: string,
    score: number,
    onlyIfAbsent?: boolean
  ) {
    const members = this.indexes.get(index) ?? new Map<string, number>();
    this.indexes.set(index, members);
    if (onlyIfAbsent && members.has(member)) return;
    members.set(member, score);
  }

  #sorted(index: string, min?: number, max?: number): IndexEntry[] {
    return [...(this.indexes.get(index) ?? new Map<string, number>())]
      .map(([member, score]) => ({ member, score }))
      .filter(
        (entry) =>
          (min === undefined || entry.score >= min) &&
          (max === undefined || entry.score <= max)
      )
      .sort((a, b) =>
        a.score !== b.score
          ? a.score - b.score
          : a.member < b.member
            ? -1
            : a.member > b.member
              ? 1
              : 0
      );
  }

  #indexRange(
    index: string,
    query: { min?: number; max?: number; after?: string; limit: number }
  ) {
    const all = this.#sorted(index, query.min, query.max);
    const start = query.after === undefined ? 0 : Number(query.after);
    const items = all.slice(start, start + query.limit);
    const end = start + items.length;
    return end < all.length ? { items, next: String(end) } : { items };
  }

  #client(): McpUseStorage {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    const oauthTtl = (seconds: number) => seconds * 1000;
    const storage: McpUseStorage = {
      kind: "reference",
      durable: true,
      shared: true,
      capabilities: { signal: true, batch: true },
      get: async (key) => db.#read(key)?.value,
      set: async (key, value, ttlSeconds) => {
        db.#put(key, value, oauthTtl(ttlSeconds));
      },
      delete: async (key) => {
        db.values.delete(key);
      },
      take: async (key) => {
        const value = db.#read(key)?.value;
        db.values.delete(key);
        return value;
      },
      add: async (key, value, ttlSeconds) =>
        db.#write(key, value, {
          ifVersion: null,
          ttlMs: oauthTtl(ttlSeconds),
        }) !== false,
      read: async (key) => db.#read(key),
      readMany: async (keys) => keys.map((key) => db.#read(key)),
      write: async (key, value, options) => db.#write(key, value, options),
      remove: async (key, options) => db.#remove(key, options),
      incr: async (key, options) => {
        const current = db.#live(key);
        const next = Number(current?.value ?? 0) + (options.by ?? 1);
        db.values.set(key, {
          value: String(next),
          version: ++db.#version,
          expiresAt: current ? current.expiresAt : db.now + options.ttlMs,
        });
        return next;
      },
      indexAdd: async (index, member, score, options) =>
        db.#indexAdd(index, member, score, options?.onlyIfAbsent),
      indexRemove: async (index, member) => {
        db.indexes.get(index)?.delete(member);
      },
      indexRange: async (index, query) => db.#indexRange(index, query),
      indexCount: async (index, query) =>
        db.#sorted(index, query?.min, query?.max).length,
      logAppend: async (stream, value, options) => {
        if (options.dedupe) {
          const existing = db.#live(options.dedupe.key);
          if (existing) return { duplicate: true, seq: Number(existing.value) };
        }
        const log = db.logs.get(stream) ?? { head: undefined, entries: [] };
        db.logs.set(stream, log);
        if (!log.head) {
          log.head = { epoch: `epoch-${++db.#epoch}`, seq: 0 };
          log.entries = [];
        }
        const seq = ++log.head.seq;
        log.entries.push({ seq, value });
        if (log.entries.length > options.maxEvents) {
          log.entries.splice(0, log.entries.length - options.maxEvents);
        }
        if (options.dedupe) {
          db.#put(options.dedupe.key, String(seq), options.dedupe.ttlMs);
        }
        if (options.mark) {
          db.#indexAdd(
            options.mark.index,
            options.mark.member,
            options.mark.score,
            true
          );
          if (options.notify !== undefined) {
            const message = `${options.mark.member}:${seq}`;
            for (const listener of db.channels.get(options.notify) ?? []) {
              listener(message);
            }
          }
        }
        return { duplicate: false, seq, epoch: log.head.epoch };
      },
      logRange: async (stream, options) => {
        const log = db.logs.get(stream);
        const head = log?.head?.seq ?? 0;
        const first = log?.entries[0]?.seq ?? head + 1;
        const entries = (log?.entries ?? [])
          .filter(
            (entry) => options.after === null || entry.seq > options.after
          )
          .slice(0, options.limit)
          .map((entry) => ({ ...entry }));
        return { entries, epoch: log?.head?.epoch ?? null, first, head };
      },
      logTrim: async (stream, options) => {
        const log = db.logs.get(stream);
        if (!log) return 0;
        const before = log.entries.length;
        log.entries = log.entries.filter(
          (entry) => entry.seq >= options.before
        );
        return before - log.entries.length;
      },
      logDelete: async (stream) => {
        db.logs.delete(stream);
      },
      batch: async (ops: ReadonlyArray<StorageOp>) => {
        const results: unknown[] = [];
        for (const op of ops) {
          try {
            results.push(await runOp(storage, op));
          } catch (error) {
            results.push(error);
          }
        }
        return results;
      },
      signal: {
        publish: async (channel, message) => {
          for (const listener of db.channels.get(channel) ?? []) {
            listener(message);
          }
        },
        subscribe: async (channel, onMessage) => {
          const listeners = db.channels.get(channel) ?? new Set();
          db.channels.set(channel, listeners);
          listeners.add(onMessage);
          return async () => {
            listeners.delete(onMessage);
          };
        },
      },
      removePrefix: async (prefix) => {
        let removed = 0;
        for (const key of [...db.values.keys()]) {
          if (key.startsWith(prefix) && db.#live(key)) {
            db.values.delete(key);
            removed++;
          }
        }
        for (const index of [...db.indexes.keys()]) {
          if (index.startsWith(prefix)) {
            db.indexes.delete(index);
            removed++;
          }
        }
        for (const stream of [...db.logs.keys()]) {
          if (stream.startsWith(prefix)) {
            db.logs.delete(stream);
            removed++;
          }
        }
        return removed;
      },
    };
    return storage;
  }
}

function runOp(storage: McpUseStorage, op: StorageOp): Promise<unknown> {
  switch (op.op) {
    case "read":
      return storage.read(op.key);
    case "write":
      return storage.write(op.key, op.value, {
        ...(op.ifVersion !== undefined && { ifVersion: op.ifVersion }),
        ...(op.ttlMs !== undefined && { ttlMs: op.ttlMs }),
      });
    case "remove":
      return storage.remove(
        op.key,
        op.ifVersion === undefined ? undefined : { ifVersion: op.ifVersion }
      );
    case "indexAdd":
      return storage.indexAdd(op.index, op.member, op.score, {
        onlyIfAbsent: op.onlyIfAbsent === true,
      });
    case "indexRemove":
      return storage.indexRemove(op.index, op.member);
    case "indexRange":
      return storage.indexRange(op.index, {
        ...(op.min !== undefined && { min: op.min }),
        ...(op.max !== undefined && { max: op.max }),
        limit: op.limit,
      });
    default:
      return Promise.reject(new TypeError("unknown storage op"));
  }
}
