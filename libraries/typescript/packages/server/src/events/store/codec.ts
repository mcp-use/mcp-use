/**
 * Forward-compatible record codec (PLAN.md §12.2.4, D67): every
 * read-modify-write merges into the decoded object so fields written by a
 * newer version survive, and values are sealed with their key as AD.
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import type { Sealer } from "./seal.js";

/** A decoded record plus the storage version it was read at. */
export interface StoredRecord<T> {
  value: T;
  version: string;
}

/**
 * Merges an update into the decoded original, keeping unknown fields.
 * Nested plain objects merge recursively; arrays and scalars are replaced.
 *
 * @param original - The decoded stored object (may hold unknown fields).
 * @param update - The fields this version writes.
 * @returns A new object.
 */
export function mergeRecord<T extends object>(original: unknown, update: T): T {
  if (!isPlain(original)) return update;
  const out: Record<string, unknown> = { ...original };
  for (const [k, v] of Object.entries(update)) {
    const prev = out[k];
    out[k] = isPlain(prev) && isPlain(v) ? mergeRecord(prev, v) : v;
  }
  return out as T;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Reads and opens a JSON record.
 *
 * @param storage - The store.
 * @param sealer - The sealer.
 * @param key - Full key.
 * @returns The record, or `undefined` when missing or unopenable.
 */
export async function readRecord<T>(
  storage: McpUseStorage,
  sealer: Sealer,
  key: string
): Promise<StoredRecord<T> | undefined> {
  const got = await storage.read(key);
  if (!got) return undefined;
  const text = await sealer.open(key, got.value);
  if (text === undefined) return undefined;
  try {
    return { value: JSON.parse(text) as T, version: got.version };
  } catch {
    return undefined;
  }
}

/**
 * Seals and writes a JSON record.
 *
 * @param storage - The store.
 * @param sealer - The sealer.
 * @param key - Full key.
 * @param value - The record.
 * @param o - `ifVersion` (`null` = put-if-absent) and `ttlMs`.
 * @returns `true` when written, `false` on a CAS conflict.
 */
export async function writeRecord(
  storage: McpUseStorage,
  sealer: Sealer,
  key: string,
  value: unknown,
  o: { ifVersion?: string | null; ttlMs?: number } = {}
): Promise<boolean> {
  const sealed = await sealer.seal(key, JSON.stringify(value));
  return (await storage.write(key, sealed, o)) !== false;
}

/**
 * CAS read-modify-write with unknown-field preservation. Retries on conflict.
 *
 * @param storage - The store.
 * @param sealer - The sealer.
 * @param key - Full key.
 * @param fn - Returns the fields to write (or `undefined` to skip) given the current value.
 * @param o - TTL and attempt bound.
 * @returns The written record, or `undefined` when `fn` skipped.
 * @throws Error after `attempts` conflicts.
 */
export async function updateRecord<T extends object>(
  storage: McpUseStorage,
  sealer: Sealer,
  key: string,
  fn: (current: T | undefined) => T | undefined,
  o: { ttlMs?: number; attempts?: number } = {}
): Promise<T | undefined> {
  const attempts = o.attempts ?? 8;
  for (let i = 0; i < attempts; i++) {
    const cur = await readRecord<T>(storage, sealer, key);
    const next = fn(cur?.value);
    if (next === undefined) return undefined;
    const merged = mergeRecord(cur?.value, next);
    const ok = await writeRecord(storage, sealer, key, merged, {
      ifVersion: cur ? cur.version : null,
      ...(o.ttlMs !== undefined ? { ttlMs: o.ttlMs } : {}),
    });
    if (ok) return merged;
  }
  throw new Error(`Events: CAS conflict persisted on ${key}`);
}
