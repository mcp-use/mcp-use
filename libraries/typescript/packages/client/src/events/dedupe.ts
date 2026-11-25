/**
 * Dedupe for the Events client (PLAN.md §9.5.5): an in-memory LRU of 4,096
 * keys plus the persisted `recentEventIds` (≤ 64, newest last) per record.
 *
 * @internal
 */

/** Default in-memory LRU capacity. */
export const DEDUPE_LRU_SIZE = 4_096;

/** Max persisted `recentEventIds` per record. */
export const RECENT_EVENT_IDS_MAX = 64;

/** A bounded, insertion-ordered set. */
export class LruSet {
  readonly #max: number;
  readonly #map = new Map<string, true>();

  /**
   * @param max - Capacity; default 4,096.
   */
  constructor(max = DEDUPE_LRU_SIZE) {
    this.#max = max;
  }

  /**
   * Record a key.
   *
   * @param key - The key.
   * @returns `true` when the key was already present (a duplicate).
   */
  seen(key: string): boolean {
    if (this.#map.has(key)) {
      this.#map.delete(key);
      this.#map.set(key, true);
      return true;
    }
    this.#map.set(key, true);
    if (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next().value;
      if (oldest !== undefined) this.#map.delete(oldest);
    }
    return false;
  }

  /**
   * Forget a key (so a failed delivery can be retried).
   *
   * @param key - The key.
   */
  forget(key: string): void {
    this.#map.delete(key);
  }

  /** Current size. */
  get size(): number {
    return this.#map.size;
  }
}

/**
 * Append an event id to a record's `recentEventIds`, newest last, capped at 64.
 *
 * @param ids - Current ids.
 * @param eventId - The new id.
 * @returns The new list.
 */
export function pushRecentEventId(
  ids: readonly string[],
  eventId: string
): string[] {
  const next = ids.filter((id) => id !== eventId);
  next.push(eventId);
  return next.length > RECENT_EVENT_IDS_MAX
    ? next.slice(next.length - RECENT_EVENT_IDS_MAX)
    : next;
}
