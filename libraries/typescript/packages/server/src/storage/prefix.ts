/**
 * The `prefix` option every storage factory accepts: one string prepended
 * to every key, index, log, dedupe key, counter and signal channel a store
 * touches, OAuth keys included, so a credential scoped to `prefix*` covers
 * everything the application writes.
 *
 * @packageDocumentation
 */
import type { OAuthProxyStorage } from "../oauth/proxy/storage.js";
import type { McpUseStorage, StorageOp } from "./types.js";

/**
 * Checks a storage prefix. A prefix is opaque to mcp-use but must not
 * contain `{` or `}`, which would change the Redis Cluster hash tag of every
 * key it is prepended to.
 *
 * @param prefix - The prefix to check.
 * @param owner - Name of the factory, used in the error message.
 * @returns The prefix, or `""` when it is `undefined`.
 */
export function validateStoragePrefix(
  prefix: string | undefined,
  owner: string
): string {
  if (prefix === undefined) return "";
  if (typeof prefix !== "string") {
    throw new TypeError(`${owner} prefix must be a string`);
  }
  if (/[{}]/.test(prefix)) {
    throw new TypeError(`${owner} prefix must not contain "{" or "}"`);
  }
  return prefix;
}

/**
 * Wraps a store so that every key, index, log, dedupe key, counter and
 * signal channel it touches starts with `prefix`. Index members, log values
 * and `indexRange` cursors are not keys and pass through unchanged.
 *
 * Only the methods the store has are wrapped, so optional methods stay
 * detectable by presence. With an empty prefix the store itself is
 * returned.
 *
 * @param storage - The store to wrap.
 * @param prefix - The prefix, already checked with {@link validateStoragePrefix}.
 * @returns A store with the same methods that reads and writes under `prefix`.
 */
export function applyStoragePrefix<T extends OAuthProxyStorage>(
  storage: T,
  prefix: string
): T {
  if (prefix === "") return storage;
  const p = (key: string) => prefix + key;
  const inner = storage as unknown as Partial<McpUseStorage>;
  const wrapped: Partial<McpUseStorage> & OAuthProxyStorage = {
    get: (key) => storage.get(p(key)),
    set: (key, value, ttlSeconds) => storage.set(p(key), value, ttlSeconds),
    delete: (key) => storage.delete(p(key)),
    take: (key) => storage.take(p(key)),
    add: (key, value, ttlSeconds) => storage.add(p(key), value, ttlSeconds),
  };
  for (const name of ["kind", "durable", "shared", "capabilities"] as const) {
    if (name in storage) {
      Object.defineProperty(wrapped, name, {
        enumerable: true,
        get: () => inner[name],
      });
    }
  }
  const { read, readMany, write, remove, incr } = inner;
  if (read) wrapped.read = (key) => read.call(storage, p(key));
  if (readMany) {
    wrapped.readMany = (keys) => readMany.call(storage, keys.map(p));
  }
  if (write) {
    wrapped.write = (key, value, options) =>
      write.call(storage, p(key), value, options);
  }
  if (remove) {
    wrapped.remove = (key, options) => remove.call(storage, p(key), options);
  }
  if (incr)
    wrapped.incr = (key, options) => incr.call(storage, p(key), options);
  const { indexAdd, indexRemove, indexRange, indexCount } = inner;
  if (indexAdd) {
    wrapped.indexAdd = (index, member, score, options) =>
      indexAdd.call(storage, p(index), member, score, options);
  }
  if (indexRemove) {
    wrapped.indexRemove = (index, member) =>
      indexRemove.call(storage, p(index), member);
  }
  if (indexRange) {
    wrapped.indexRange = (index, query) =>
      indexRange.call(storage, p(index), query);
  }
  if (indexCount) {
    wrapped.indexCount = (index, query) =>
      indexCount.call(storage, p(index), query);
  }
  const { logAppend, logRange, logTrim, logDelete } = inner;
  if (logAppend) {
    wrapped.logAppend = (stream, value, options) =>
      logAppend.call(storage, p(stream), value, {
        ...options,
        ...(options.dedupe && {
          dedupe: { ...options.dedupe, key: p(options.dedupe.key) },
        }),
        ...(options.mark && {
          mark: { ...options.mark, index: p(options.mark.index) },
        }),
        ...(options.notify !== undefined && { notify: p(options.notify) }),
      });
  }
  if (logRange) {
    wrapped.logRange = (stream, options) =>
      logRange.call(storage, p(stream), options);
  }
  if (logTrim) {
    wrapped.logTrim = (stream, options) =>
      logTrim.call(storage, p(stream), options);
  }
  if (logDelete)
    wrapped.logDelete = (stream) => logDelete.call(storage, p(stream));
  const { batch, removePrefix, signal } = inner;
  if (batch) {
    wrapped.batch = (ops) =>
      batch.call(
        storage,
        ops.map((op) => prefixOp(op, p))
      );
  }
  if (removePrefix) {
    wrapped.removePrefix = (keyPrefix) =>
      removePrefix.call(storage, p(keyPrefix));
  }
  if (signal) {
    wrapped.signal = {
      publish: (channel, message) => signal.publish(p(channel), message),
      subscribe: (channel, onMessage) =>
        signal.subscribe(p(channel), onMessage),
    };
  }
  return wrapped as unknown as T;
}

function prefixOp(op: StorageOp, p: (key: string) => string): StorageOp {
  switch (op.op) {
    case "read":
    case "write":
    case "remove":
      return { ...op, key: p(op.key) };
    case "indexAdd":
    case "indexRemove":
    case "indexRange":
      return { ...op, index: p(op.index) };
    default: {
      const unknown: never = op;
      throw new TypeError(
        `Unknown storage op ${JSON.stringify((unknown as { op?: unknown }).op)}`
      );
    }
  }
}
