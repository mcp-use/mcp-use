/**
 * The D32 catalog lifecycle: write the catalog record at start, mark missing
 * events dormant, remove them after 24 h missing, and terminate on an
 * incompatible in-place schema change.
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import { EVENTS_DEFAULTS } from "../config.js";
import type { EventsRegistry } from "../internal/registry.js";
import type { CatalogRecord } from "../internal/records.js";

/** `ev:{ns}:catalog:missing`: name → first ms seen missing. */
export type CatalogMissing = Record<string, number>;

/** Storage the lifecycle needs (provided by the backend assembly, WP-20). */
export interface CatalogStore {
  read(): Promise<{ record: CatalogRecord | null; version: string | null }>;
  /** Compare-and-set; returns false when `version` is stale. */
  write(record: CatalogRecord, version: string | null): Promise<boolean>;
  readMissing(): Promise<CatalogMissing>;
  writeMissing(m: CatalogMissing): Promise<void>;
}

/** Result of {@link diffCatalog}. */
export interface CatalogDiff {
  record: CatalogRecord;
  /** Names in the stored record no longer registered (dormant). */
  missing: string[];
  /** Names whose schema hash changed in place. */
  schemaChanged: string[];
  /** Whether the stored record must be rewritten. */
  changed: boolean;
}

/** Builds the catalog record of this process and diffs it against the stored one. */
export function diffCatalog(
  stored: CatalogRecord | null,
  registry: EventsRegistry,
  now: number,
  deployment?: string
): CatalogDiff {
  const events: CatalogRecord["events"] = {};
  for (const ev of registry.all())
    events[ev.name] = {
      schemaHash: ev.schemaHash,
      replay: ev.replay !== false,
      hooks: { ...ev.hooks },
    };
  const record: CatalogRecord = {
    v: 1,
    hash: registry.catalogHash,
    writtenAt: now,
    events,
    ...(deployment !== undefined ? { deployment } : {}),
  };
  const missing: string[] = [];
  const schemaChanged: string[] = [];
  for (const [name, prev] of Object.entries(stored?.events ?? {})) {
    const cur = events[name];
    if (!cur) missing.push(name);
    else if (cur.schemaHash !== prev.schemaHash) schemaChanged.push(name);
  }
  return {
    record,
    missing,
    schemaChanged,
    changed: stored?.hash !== record.hash,
  };
}

/**
 * The error that terminates subscriptions of an incompatible in-place change.
 *
 * @param feature - Which schema changed.
 */
export function schemaChangedError(
  feature: "payloadSchema" | "inputSchema"
): EventsError {
  return new EventsError("unsupported", "", {
    feature,
    reason: "schema_changed",
  });
}

/** The error sent for an event removed from the catalog. */
export function eventRemovedError(): EventsError {
  return new EventsError("notFound", "", { kind: "event" });
}

/**
 * Merges this start's missing set into the stored one: names that came back
 * are cleared, newly missing names get `now`.
 */
export function updateMissing(
  prev: CatalogMissing,
  missingNow: readonly string[],
  now: number
): CatalogMissing {
  const out: CatalogMissing = {};
  for (const n of missingNow) out[n] = prev[n] ?? now;
  return out;
}

/** Names missing for at least `dormancyMs` (default 24 h): due for removal. */
export function dueForRemoval(
  missing: CatalogMissing,
  now: number,
  dormancyMs = EVENTS_DEFAULTS.catalogDormancyMs
): string[] {
  return Object.entries(missing)
    .filter(([, since]) => now - since >= dormancyMs)
    .map(([n]) => n);
}

/**
 * Writes the catalog at start (CAS when the hash differs) and records missing
 * events. Returns the diff so the caller can terminate schema-changed events.
 */
export async function writeCatalogAtStart(
  store: CatalogStore,
  registry: EventsRegistry,
  now: number,
  deployment?: string
): Promise<CatalogDiff> {
  for (let attempt = 0; ; attempt++) {
    const { record: stored, version } = await store.read();
    const diff = diffCatalog(stored, registry, now, deployment);
    const prevMissing = await store.readMissing();
    const missing = updateMissing(prevMissing, diff.missing, now);
    // Events missing since an earlier start stay missing until they return.
    for (const [n, since] of Object.entries(prevMissing))
      if (!registry.get(n) && missing[n] === undefined) missing[n] = since;
    await store.writeMissing(missing);
    if (!diff.changed) return diff;
    if (await store.write(diff.record, version)) return diff;
    if (attempt >= 4) return diff;
  }
}
