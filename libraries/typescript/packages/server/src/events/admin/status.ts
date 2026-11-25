/**
 * Key-less admin reads (PLAN.md §12.3.3, D63): `status()` and
 * `nextWakeAt()` need only the storage credential. Also the admin key
 * helpers for layout-1 families.
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import { nsKey } from "../binding/namespace.js";
import type { EventsStatus } from "./types.js";

/** Layout-1 keys the admin library touches, for one namespace hash. */
export interface AdminKeys {
  hash: string;
  meta: string;
  closed: string;
  catalog: string;
  due: string;
  fanoutDue: string;
  expiry: string;
  dead: string;
  leaseExpiry: string;
  sub(id: string): string;
  status(id: string): string;
  lease(id: string): string;
  job(id: string): string;
  deadLetter(id: string): string;
  attempts(id: string): string;
  /** `ev:{<ns16>}:` — every key of the namespace starts with it. */
  prefix: string;
}

/**
 * Build the admin key set.
 *
 * @param hash - The `ns16` hash.
 */
export function adminKeys(hash: string): AdminKeys {
  const k = (s: string) => nsKey(hash, s);
  return {
    hash,
    meta: k("meta"),
    closed: k("closed"),
    catalog: k("catalog"),
    due: k("due"),
    fanoutDue: k("fanout-due"),
    expiry: k("expiry"),
    dead: k("dead"),
    leaseExpiry: k("lease-expiry"),
    sub: (id) => k(`sub:${id}`),
    status: (id) => k(`status:${id}`),
    lease: (id) => k(`lease:${id}`),
    job: (id) => k(`job:${id}`),
    deadLetter: (id) => k(`dead:${id}`),
    attempts: (id) => k(`attempts:${id}`),
    prefix: `ev:{${hash}}:`,
  };
}

async function firstScore(
  storage: McpUseStorage,
  index: string
): Promise<number | null> {
  const page = await storage.indexRange(index, { limit: 1 });
  const first = page.items[0];
  return first === undefined ? null : first.score;
}

/**
 * `nextWakeAt` (D63): min of the first scores of `idx due` and
 * `idx fanout-due`, or null.
 *
 * @param storage - Prefixed storage.
 * @param keys - Admin keys.
 */
export async function readNextWakeAt(
  storage: McpUseStorage,
  keys: AdminKeys
): Promise<Date | null> {
  const [a, b] = await Promise.all([
    firstScore(storage, keys.due),
    firstScore(storage, keys.fanoutDue),
  ]);
  const scores = [a, b].filter((s): s is number => s !== null);
  return scores.length === 0 ? null : new Date(Math.min(...scores));
}

/**
 * Key-less namespace status.
 *
 * @param storage - Prefixed storage.
 * @param keys - Admin keys.
 * @param now - Current time in ms.
 */
export async function readStatus(
  storage: McpUseStorage,
  keys: AdminKeys,
  now: number
): Promise<EventsStatus> {
  const [
    meta,
    closed,
    due,
    fanoutDue,
    deadLetters,
    subscriptions,
    leases,
    oldest,
    wake,
  ] = await Promise.all([
    storage.read(keys.meta),
    storage.read(keys.closed),
    storage.indexCount(keys.due),
    storage.indexCount(keys.fanoutDue),
    storage.indexCount(keys.dead),
    storage.indexCount(keys.expiry),
    storage.indexCount(keys.leaseExpiry),
    firstScore(storage, keys.due),
    readNextWakeAt(storage, keys),
  ]);
  let layout: 1 | null = null;
  if (meta !== undefined) {
    try {
      const parsed = JSON.parse(meta.value) as { layout?: unknown };
      if (parsed.layout === 1) layout = 1;
    } catch {
      layout = null;
    }
  }
  return {
    layout,
    closed: closed !== undefined,
    due,
    fanoutDue,
    oldestDueAgeMs: oldest === null ? null : Math.max(0, now - oldest),
    nextWakeAt: wake === null ? null : wake.toISOString(),
    deadLetters,
    subscriptions,
    leases,
  };
}
