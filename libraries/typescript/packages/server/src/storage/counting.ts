/**
 * A wrapper that counts storage calls per operation, for the command budgets
 * of MCP Events (one call is one round trip on the Redis family).
 *
 * @packageDocumentation
 */
import type { McpUseStorage } from "./types.js";

/** Names of the operations a {@link CountingStorage} counts. */
export type CountedStorageOperation =
  | "get"
  | "set"
  | "delete"
  | "take"
  | "add"
  | "read"
  | "readMany"
  | "write"
  | "remove"
  | "incr"
  | "indexAdd"
  | "indexRemove"
  | "indexRange"
  | "indexCount"
  | "logAppend"
  | "logRange"
  | "logTrim"
  | "logDelete"
  | "batch"
  | "removePrefix"
  | "signal.publish"
  | "signal.subscribe";

/** A store that counts the calls made through it. */
export interface CountingStorage extends McpUseStorage {
  /**
   * Calls per operation since the store was created or last reset.
   * Operations never called are absent. A `batch` counts once, whatever it
   * holds.
   *
   * @returns A snapshot of the counts.
   */
  counts(): Partial<Record<CountedStorageOperation, number>>;
  /**
   * Calls of every operation since the store was created or last reset.
   *
   * @returns The sum of {@link CountingStorage.counts}.
   */
  total(): number;
  /** Sets every count back to zero. */
  reset(): void;
}

const METHODS = [
  "get",
  "set",
  "delete",
  "take",
  "add",
  "read",
  "readMany",
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
  "batch",
  "removePrefix",
] as const;

/**
 * Wraps a store so that every call through it is counted per operation, so
 * a test can assert a literal command budget (for example "one emit is one
 * `logAppend`"). Calls the store makes internally are not counted. Optional
 * methods are wrapped only when the store has them.
 *
 * @param storage - The store to count.
 * @returns The same store with {@link CountingStorage.counts},
 * {@link CountingStorage.total} and {@link CountingStorage.reset}.
 */
export function countingStorage(storage: McpUseStorage): CountingStorage {
  let counts: Partial<Record<CountedStorageOperation, number>> = {};
  const count = (operation: CountedStorageOperation) => {
    counts[operation] = (counts[operation] ?? 0) + 1;
  };
  const wrapped: Record<string, unknown> = {
    counts: () => ({ ...counts }),
    total: () =>
      Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0),
    reset: () => {
      counts = {};
    },
  };
  for (const name of ["kind", "durable", "shared", "capabilities"] as const) {
    Object.defineProperty(wrapped, name, {
      enumerable: true,
      get: () => storage[name],
    });
  }
  const source = storage as unknown as Record<string, unknown>;
  for (const name of METHODS) {
    const method = source[name];
    if (typeof method !== "function") continue;
    wrapped[name] = (...args: unknown[]): unknown => {
      count(name);
      return (method as (...values: unknown[]) => unknown).apply(storage, args);
    };
  }
  const signal = storage.signal;
  if (signal) {
    wrapped["signal"] = {
      publish: (channel: string, message: string) => {
        count("signal.publish");
        return signal.publish(channel, message);
      },
      subscribe: (channel: string, onMessage: (message: string) => void) => {
        count("signal.subscribe");
        return signal.subscribe(channel, onMessage);
      },
    } satisfies McpUseStorage["signal"];
  }
  return wrapped as unknown as CountingStorage;
}
