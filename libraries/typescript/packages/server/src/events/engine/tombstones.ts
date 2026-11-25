/**
 * Tombstones (D37): a revoked subscription key stays refused until its
 * tombstone expires; the backend stores `ev:{ns}:tomb:{id}`.
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import type { EventsBackend, SubscriptionKey } from "../internal/backend.js";
import { EVENTS_DEFAULTS } from "../config.js";

/** How long a tombstone refuses re-subscription (the record retention window). */
export const TOMBSTONE_TTL_MS = EVENTS_DEFAULTS.recordRetentionAfterExpiryMs;

/**
 * Throws Forbidden `{reason:"revoked"}` when `key` is tombstoned.
 *
 * @param backend - The engine backend.
 * @param key - The subscription identity.
 */
export async function assertNotTombstoned(
  backend: Pick<EventsBackend, "isRevoked">,
  key: SubscriptionKey
): Promise<void> {
  if (await backend.isRevoked(key))
    throw new EventsError("forbidden", "", { reason: "revoked" });
}
