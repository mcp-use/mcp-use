/**
 * Active catalog (PLAN.md §12.2.3, D32): `ev:{ns}:catalog` is written by CAS
 * at start when its hash differs; `ev:{ns}:catalog:missing` records when a
 * previously cataloged name went missing.
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import type { CatalogRecord } from "../internal/records.js";
import type { EventsRegistry } from "../internal/registry.js";
import { mergeRecord, readRecord, writeRecord } from "./codec.js";
import type { EventsKeys } from "./keys.js";
import type { Sealer } from "./seal.js";

/**
 * Builds the catalog record of the running registry.
 *
 * @param registry - The process registry.
 * @param now - Epoch ms.
 * @param deployment - Optional deployment label.
 * @returns The record.
 */
export function buildCatalogRecord(
  registry: EventsRegistry,
  now: number,
  deployment?: string
): CatalogRecord {
  const events: CatalogRecord["events"] = {};
  for (const e of registry.all()) {
    events[e.name] = {
      schemaHash: e.schemaHash,
      replay: e.replay !== false,
      hooks: { ...e.hooks },
    };
  }
  const rec: CatalogRecord = {
    v: 1,
    hash: registry.catalogHash,
    writtenAt: now,
    events,
  };
  if (deployment !== undefined) rec.deployment = deployment;
  return rec;
}

/** Outcome of {@link syncCatalog}. */
export interface CatalogSync {
  /** Whether this call wrote the catalog. */
  written: boolean;
  /** `{name: missingSince}` after the update. */
  missing: Record<string, number>;
}

/**
 * Writes the catalog when its hash differs (CAS), and updates the missing
 * map: names in the stored catalog but not in `record` get `missingSince`,
 * names present again are removed.
 *
 * @param storage - The store.
 * @param sealer - The sealer.
 * @param keys - Key codec.
 * @param record - From {@link buildCatalogRecord}.
 * @returns What changed.
 */
export async function syncCatalog(
  storage: McpUseStorage,
  sealer: Sealer,
  keys: EventsKeys,
  record: CatalogRecord
): Promise<CatalogSync> {
  let written = false;
  let previous: CatalogRecord | undefined;
  for (let i = 0; i < 5; i++) {
    const cur = await readRecord<CatalogRecord>(
      storage,
      sealer,
      keys.catalog()
    );
    previous = cur?.value;
    if (cur && cur.value.hash === record.hash) break;
    const next = mergeRecord(cur?.value, record);
    next.events = record.events;
    if (
      await writeRecord(storage, sealer, keys.catalog(), next, {
        ifVersion: cur ? cur.version : null,
      })
    ) {
      written = true;
      break;
    }
  }
  const missingKey = keys.catalogMissing();
  let missing: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    const cur = await readRecord<Record<string, number>>(
      storage,
      sealer,
      missingKey
    );
    const next: Record<string, number> = { ...(cur?.value ?? {}) };
    for (const name of Object.keys(next)) {
      if (name in record.events) delete next[name];
    }
    for (const name of Object.keys(previous?.events ?? {})) {
      if (!(name in record.events) && next[name] === undefined) {
        next[name] = record.writtenAt;
      }
    }
    missing = next;
    if (JSON.stringify(next) === JSON.stringify(cur?.value ?? {})) break;
    if (
      await writeRecord(storage, sealer, missingKey, next, {
        ifVersion: cur ? cur.version : null,
      })
    )
      break;
  }
  return { written, missing };
}
