/**
 * `purge` (D68): delete the namespace and leave `closed` for 7 days.
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import type { AdminKeys } from "./status.js";

/** How long `closed` survives a purge. */
export const CLOSED_TTL_MS = 7 * 24 * 3_600_000;

const INDEX_FAMILIES = (k: AdminKeys) => [
  {
    index: k.expiry,
    keys: (id: string) => [k.sub(id), k.status(id), k.attempts(id)],
  },
  { index: k.due, keys: (id: string) => [k.job(id)] },
  { index: k.dead, keys: (id: string) => [k.deadLetter(id)] },
  { index: k.leaseExpiry, keys: (id: string) => [k.lease(id)] },
];

/**
 * Delete every key of the namespace. Uses `removePrefix` when the storage
 * has it; otherwise deletes what the indexes reach.
 *
 * @param storage - Prefixed storage.
 * @param keys - Admin keys.
 * @param reason - Written into `closed`.
 * @param now - Current time in ms.
 */
export async function purgeNamespace(
  storage: McpUseStorage,
  keys: AdminKeys,
  reason = "purged",
  now = Date.now()
): Promise<{ deletedKeys: number }> {
  let deleted = 0;
  if (typeof storage.removePrefix === "function") {
    deleted = await storage.removePrefix(keys.prefix);
  } else {
    for (const fam of INDEX_FAMILIES(keys)) {
      for (;;) {
        const p = await storage.indexRange(fam.index, { limit: 500 });
        if (p.items.length === 0) break;
        for (const item of p.items) {
          for (const key of fam.keys(item.member)) {
            if (key === keys.attempts(item.member))
              await storage.logDelete(key);
            else if (await storage.remove(key)) deleted++;
          }
          await storage.indexRemove(fam.index, item.member);
        }
      }
    }
    // TODO(events): event logs and by-name indexes need the catalog names; the
    // fallback path reaches only index-listed records.
    for (const key of [keys.meta, keys.catalog, keys.closed, keys.fanoutDue])
      if (await storage.remove(key)) deleted++;
  }
  await storage.write(keys.closed, JSON.stringify({ at: now, reason }), {
    ttlMs: CLOSED_TTL_MS,
  });
  return { deletedKeys: deleted };
}
