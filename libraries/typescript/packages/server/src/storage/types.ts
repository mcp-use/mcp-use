/**
 * The `McpUseStorage` contract: the storage primitives that `oauthProxy` and
 * MCP Events share, and the runtime guards that check a value implements
 * them.
 *
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "../oauth/proxy/storage.js";

/** A value plus an opaque version for compare-and-set. */
export interface Versioned {
  /** The stored value. */
  value: string;
  /**
   * Opaque version of the value. It changes on every write; pass it back as
   * `ifVersion` to write or remove only while the value is unchanged.
   */
  version: string;
}

/** Optional features a store reports, so callers can pick a fallback. */
export interface StorageCapabilities {
  /** `signal` is implemented (pub/sub wake for open event streams). */
  signal: boolean;
  /** `batch` sends several ops in one round trip. */
  batch: boolean;
}

/** Options for {@link McpUseStorage.write}. */
export interface StorageWriteOptions {
  /**
   * Compare-and-set condition. `null` writes only when the key is absent; a
   * version string writes only while the stored version equals it; omitted
   * writes unconditionally.
   */
  ifVersion?: string | null;
  /** Milliseconds until the key expires. Omitted means no expiry. */
  ttlMs?: number;
}

/** Options for {@link McpUseStorage.remove}. */
export interface StorageRemoveOptions {
  /** Removes the key only while its stored version equals this one. */
  ifVersion?: string;
}

/** Options for {@link McpUseStorage.incr}. */
export interface StorageIncrOptions {
  /** Milliseconds until the counter expires, set on its first increment only. */
  ttlMs: number;
  /**
   * Amount to add.
   *
   * @defaultValue `1`
   */
  by?: number;
}

/** Options for {@link McpUseStorage.indexAdd}. */
export interface IndexAddOptions {
  /** Adds the member only when it is absent, keeping an existing score. */
  onlyIfAbsent?: boolean;
}

/** A page request for {@link McpUseStorage.indexRange}. */
export interface IndexRangeQuery {
  /** Lowest score included (inclusive). Omitted means no lower bound. */
  min?: number;
  /** Highest score included (inclusive). Omitted means no upper bound. */
  max?: number;
  /** The `next` value of the previous page; the page starts after it (exclusive). */
  after?: string;
  /** Most members to return. */
  limit: number;
}

/** One member of a sorted index and its score. */
export interface IndexEntry {
  /** The member. */
  member: string;
  /** The member's score. */
  score: number;
}

/** A page of {@link McpUseStorage.indexRange}. */
export interface IndexRangePage {
  /** Members ordered by `(score, member)` ascending. */
  items: IndexEntry[];
  /** Pass as `after` to read the next page. Absent when no member follows. */
  next?: string;
}

/** A score range for {@link McpUseStorage.indexCount}. */
export interface IndexCountQuery {
  /** Lowest score counted (inclusive). */
  min?: number;
  /** Highest score counted (inclusive). */
  max?: number;
}

/** Options for {@link McpUseStorage.logAppend}. */
export interface LogAppendOptions {
  /** Keep at most this many newest entries (approximate trimming within +10 % is allowed). */
  maxEvents: number;
  /**
   * Idempotency key. When it exists the append is a duplicate and nothing
   * else happens; otherwise it is set to the new seq for `ttlMs`.
   */
  dedupe?: {
    /** Storage key of the dedupe record. */
    key: string;
    /** Milliseconds the dedupe record lives. */
    ttlMs: number;
  };
  /** A sorted-index member added with `onlyIfAbsent` by the same atomic append. */
  mark?: {
    /** Index name. */
    index: string;
    /** Member to add. */
    member: string;
    /** Score of the member when it is added. */
    score: number;
  };
  /** Channel on which `"{mark.member}:{seq}"` is published when signals are supported. */
  notify?: string;
}

/** Result of {@link McpUseStorage.logAppend}. */
export type LogAppendResult =
  | {
      /** The entry was appended. */
      duplicate: false;
      /** Position of the new entry, `head + 1`. */
      seq: number;
      /** Epoch of the log the entry was appended to. */
      epoch: string;
    }
  | {
      /** The dedupe key existed, so nothing was appended. */
      duplicate: true;
      /** Seq stored under the dedupe key, or `null` when it is unknown. */
      seq: number | null;
    };

/** Options for {@link McpUseStorage.logRange}. */
export interface LogRangeOptions {
  /** Return entries with `seq > after`; `null` starts at the first entry. */
  after: number | null;
  /** Most entries to return; `0` returns only `epoch`, `first` and `head`. */
  limit: number;
}

/** One log entry. */
export interface LogEntry {
  /** Position in the log, starting at 1 in each epoch. */
  seq: number;
  /** The appended value. */
  value: string;
}

/** Result of {@link McpUseStorage.logRange}. */
export interface LogRangeResult {
  /** Entries in ascending `seq` order. */
  entries: LogEntry[];
  /** Epoch of the log, or `null` when the log has no head (never written or deleted). */
  epoch: string | null;
  /** Seq of the oldest retained entry; `head + 1` when the log is empty. */
  first: number;
  /** Seq of the newest entry ever appended in this epoch, `0` before the first append. */
  head: number;
}

/** Options for {@link McpUseStorage.logTrim}. */
export interface LogTrimOptions {
  /** Remove entries with `seq < before`. */
  before: number;
}

/** Lossy publish/subscribe used to wake readers of a log. */
export interface StorageSignal {
  /**
   * Publishes a message to everyone subscribed to the channel now.
   *
   * @param channel - Channel name; the store's prefix applies to it.
   * @param message - Message text.
   */
  publish(channel: string, message: string): Promise<void>;
  /**
   * Subscribes to a channel. Messages published after the returned promise
   * resolves are delivered, best effort.
   *
   * @param channel - Channel name; the store's prefix applies to it.
   * @param onMessage - Called with each message.
   * @returns A function that ends the subscription.
   */
  subscribe(
    channel: string,
    onMessage: (message: string) => void
  ): Promise<() => Promise<void>>;
}

/**
 * Framework storage: a superset of `OAuthProxyStorage` (`get`, `set`,
 * `delete`, `take`, `add`), so one store serves `oauthProxy` and Events.
 *
 * Implementations must be linearizable per key and per log, and shared by
 * all instances of the server unless `shared` is `false`. Validate an
 * implementation with `runStorageConformance()` from `mcp-use/storage/testing`.
 * Every key an adapter receives is already namespaced by its caller; the
 * adapter prepends its own `prefix`.
 */
export interface McpUseStorage extends OAuthProxyStorage {
  /** Adapter name: `"redis"`, `"upstash"`, `"postgres"`, `"d1"`, `"durable-object"`, `"memory"`, `"file"`, or a third-party name. */
  readonly kind: string;
  /** Whether stored data survives a process restart. */
  readonly durable: boolean;
  /** Whether every instance of the server sees the same data. */
  readonly shared: boolean;
  /** Optional features this store implements. */
  readonly capabilities: StorageCapabilities;

  /**
   * Reads a value and its version.
   *
   * @param key - Storage key.
   * @returns The value and version, or `undefined` when absent or expired.
   */
  read(key: string): Promise<Versioned | undefined>;
  /**
   * Reads several values in one round trip. When absent, callers fall back
   * to `Promise.all(keys.map(read))`.
   *
   * @param keys - Storage keys.
   * @returns One result per key, in order.
   */
  readMany?(keys: readonly string[]): Promise<(Versioned | undefined)[]>;
  /**
   * Writes a value, optionally only when absent (`ifVersion: null`) or
   * unchanged (`ifVersion: "<version>"`).
   *
   * @param key - Storage key.
   * @param value - Value to store.
   * @param options - Compare-and-set condition and expiry.
   * @returns The new version, or `false` when the condition did not hold.
   */
  write(
    key: string,
    value: string,
    options?: StorageWriteOptions
  ): Promise<string | false>;
  /**
   * Removes a value, optionally only while its version is unchanged.
   *
   * @param key - Storage key.
   * @param options - Compare-and-set condition.
   * @returns `true` when a value was removed.
   */
  remove(key: string, options?: StorageRemoveOptions): Promise<boolean>;
  /**
   * Atomically adds to a counter, creating it with `ttlMs` on its first
   * increment. Later increments do not extend the expiry.
   *
   * @param key - Storage key.
   * @param options - Expiry and increment.
   * @returns The counter's new value.
   */
  incr(key: string, options: StorageIncrOptions): Promise<number>;

  /**
   * Adds a member to a sorted index or updates its score.
   *
   * @param index - Index name.
   * @param member - Member.
   * @param score - Score.
   * @param options - `onlyIfAbsent` keeps an existing member's score.
   */
  indexAdd(
    index: string,
    member: string,
    score: number,
    options?: IndexAddOptions
  ): Promise<void>;
  /**
   * Removes a member. Removing an absent member is not an error.
   *
   * @param index - Index name.
   * @param member - Member.
   */
  indexRemove(index: string, member: string): Promise<void>;
  /**
   * Reads one page of members ordered by `(score, member)`.
   *
   * @param index - Index name.
   * @param query - Score bounds, page cursor and size.
   * @returns The page and, when more members may follow, a `next` cursor.
   */
  indexRange(index: string, query: IndexRangeQuery): Promise<IndexRangePage>;
  /**
   * Counts members, optionally within a score range.
   *
   * @param index - Index name.
   * @param query - Inclusive score bounds.
   * @returns The number of members.
   */
  indexCount(index: string, query?: IndexCountQuery): Promise<number>;

  /**
   * Atomically: if `dedupe.key` exists, returns `{ duplicate: true, seq }`
   * and does nothing else; otherwise allocates `seq = head + 1` (minting an
   * epoch and emptying the log if its head record is absent), appends
   * `value`, caps the log to the newest `maxEvents` entries, sets
   * `dedupe.key` to the seq for `ttlMs`, adds `mark` with `onlyIfAbsent`, and
   * publishes `"{mark.member}:{seq}"` on `notify` when signals are supported.
   *
   * @param stream - Log name.
   * @param value - Entry value.
   * @param options - Cap, dedupe, mark and notify.
   * @returns The new entry's seq and epoch, or the duplicate's stored seq.
   */
  logAppend(
    stream: string,
    value: string,
    options: LogAppendOptions
  ): Promise<LogAppendResult>;
  /**
   * Reads entries with `seq > after`, ascending, at most `limit`.
   *
   * @param stream - Log name.
   * @param options - Start position and page size.
   * @returns The entries plus the log's epoch, first and head positions.
   */
  logRange(stream: string, options: LogRangeOptions): Promise<LogRangeResult>;
  /**
   * Removes entries with `seq < before`.
   *
   * @param stream - Log name.
   * @param options - Trim position.
   * @returns The number of entries removed.
   */
  logTrim(stream: string, options: LogTrimOptions): Promise<number>;
  /**
   * Deletes the log and its head, so the next append mints a new epoch and
   * starts at seq 1.
   *
   * @param stream - Log name.
   */
  logDelete(stream: string): Promise<void>;

  /**
   * Sends independent ops in one round trip. It is not atomic: one failing
   * op does not roll back the others. When absent, callers run the ops one
   * after another.
   *
   * @param ops - Operations to run.
   * @returns One result per op, in order: what the matching method returns.
   */
  batch?(ops: ReadonlyArray<StorageOp>): Promise<unknown[]>;
  /** Wake signal (lossy). When absent, readers poll the log instead. */
  signal?: StorageSignal;
  /**
   * Deletes every key under a prefix (purge). When absent, callers walk
   * their indexes and known keys instead.
   *
   * @param prefix - Key prefix, after the store's own prefix.
   * @returns The number of keys removed.
   */
  removePrefix?(prefix: string): Promise<number>;
}

/** One operation of {@link McpUseStorage.batch}. */
export type StorageOp =
  | {
      /** Operation name. */
      op: "read";
      /** Storage key. */
      key: string;
    }
  | {
      /** Operation name. */
      op: "write";
      /** Storage key. */
      key: string;
      /** Value to store. */
      value: string;
      /** Compare-and-set condition, as for `write`. */
      ifVersion?: string | null;
      /** Milliseconds until the key expires. */
      ttlMs?: number;
    }
  | {
      /** Operation name. */
      op: "remove";
      /** Storage key. */
      key: string;
      /** Compare-and-set condition, as for `remove`. */
      ifVersion?: string;
    }
  | {
      /** Operation name. */
      op: "indexAdd";
      /** Index name. */
      index: string;
      /** Member. */
      member: string;
      /** Score. */
      score: number;
      /** Keeps an existing member's score. */
      onlyIfAbsent?: boolean;
    }
  | {
      /** Operation name. */
      op: "indexRemove";
      /** Index name. */
      index: string;
      /** Member. */
      member: string;
    }
  | {
      /** Operation name. */
      op: "indexRange";
      /** Index name. */
      index: string;
      /** Lowest score (inclusive). */
      min?: number;
      /** Highest score (inclusive). */
      max?: number;
      /** Most members to return. */
      limit: number;
    };

/** Codes of {@link StorageError}. */
export type StorageErrorCode =
  /** The value is not usable as Events storage (for example a Workers KV binding). */
  | "STORAGE_UNSUPPORTED"
  /** The driver a storage URL needs (`ioredis`, `redis` or `pg`) is not installed. */
  | "STORAGE_DRIVER_MISSING"
  /** `MCP_USE_STORAGE_URL` or its companion variables are malformed or incomplete. */
  | "STORAGE_URL_INVALID";

/** An error from storage validation or from opening a storage URL. */
export class StorageError extends Error {
  /** Stable code to branch on. */
  readonly code: StorageErrorCode;

  /**
   * @param code - Stable code.
   * @param message - Message with the fix.
   */
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

const REQUIRED_METHODS = [
  "get",
  "set",
  "delete",
  "take",
  "add",
  "read",
  "write",
  "remove",
  "incr",
  "indexAdd",
  "indexRemove",
  "indexRange",
  "indexCount",
  "logAppend",
  "logRange",
  "logTrim",
  "logDelete",
] as const;

/**
 * Whether a value implements every required method of {@link McpUseStorage}
 * and reports its `kind`, `durable`, `shared` and `capabilities`.
 *
 * @param value - The value to check.
 * @returns `true` for a full `McpUseStorage`.
 */
export function isMcpUseStorage(value: unknown): value is McpUseStorage {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const capabilities = record["capabilities"];
  return (
    REQUIRED_METHODS.every((name) => typeof record[name] === "function") &&
    typeof record["kind"] === "string" &&
    typeof record["durable"] === "boolean" &&
    typeof record["shared"] === "boolean" &&
    capabilities !== null &&
    typeof capabilities === "object"
  );
}

/**
 * Checks that a value can hold Events state, and throws a
 * {@link StorageError} with code `STORAGE_UNSUPPORTED` that names the fix
 * when it cannot: a Workers KV binding (eventually consistent, no
 * compare-and-set) or a store that implements only `OAuthProxyStorage`.
 *
 * @param value - The configured storage.
 */
export function assertMcpUseStorage(
  value: unknown
): asserts value is McpUseStorage {
  if (isMcpUseStorage(value)) return;
  if (isWorkersKvBinding(value)) {
    throw new StorageError(
      "STORAGE_UNSUPPORTED",
      "A Workers KV binding cannot hold Events state: it is eventually consistent and has no compare-and-set. Use cloudflareStorage({ d1 }) with a D1 database or cloudflareStorage({ durableObject }) with a Durable Object instead."
    );
  }
  const record =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const missing = REQUIRED_METHODS.filter(
    (name) => typeof record[name] !== "function"
  );
  throw new StorageError(
    "STORAGE_UNSUPPORTED",
    missing.length > 0
      ? `This storage cannot hold Events state: it does not implement ${missing.join(", ")}. Use a store from mcp-use/storage, or implement McpUseStorage and check it with runStorageConformance().`
      : "This storage cannot hold Events state: it does not report kind, durable, shared and capabilities. Implement McpUseStorage and check it with runStorageConformance()."
  );
}

/** A Workers KV namespace binding: `get`, `put`, `list`, `getWithMetadata`. */
function isWorkersKvBinding(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["getWithMetadata"] === "function" &&
    typeof record["put"] === "function" &&
    typeof record["list"] === "function"
  );
}
