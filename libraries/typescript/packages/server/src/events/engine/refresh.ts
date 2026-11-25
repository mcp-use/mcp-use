/**
 * Refresh semantics (PLAN.md §6.7 "Cursor on the result"): a live record
 * ignores the cursor; a record whose create was interrupted, or a lapsed
 * record, uses it as a create would.
 *
 * @internal
 */

import type { SubscriptionRecord } from "../internal/records.js";

/** How the subscribe call treats `cursor` and `maxAgeMs`. */
export interface SubscribeCursorPolicy {
  /** `"create"`, `"refresh"` (live), `"resume"` (create interrupted) or `"lapsed"`. */
  kind: "create" | "refresh" | "resume" | "lapsed";
  /** Pass the client's cursor and `maxAgeMs` to the backend. */
  useCursor: boolean;
  /** Cursors appear on the result (`replay` and `replayCursors` both on). */
  cursorsOn: boolean;
}

/**
 * Decides the cursor policy of one subscribe call.
 *
 * @param o - The stored record (or `null`), the time and the event/profile replay switches.
 */
export function subscribeCursorPolicy(o: {
  record: Pick<SubscriptionRecord, "start" | "expiresAt"> | null;
  now: number;
  replayable: boolean;
  replayCursors: boolean;
}): SubscribeCursorPolicy {
  const cursorsOn = o.replayable && o.replayCursors;
  let kind: SubscribeCursorPolicy["kind"];
  if (o.record === null) kind = "create";
  else if (o.record.expiresAt !== null && o.record.expiresAt <= o.now)
    kind = "lapsed";
  else if (o.record.start === null) kind = "resume";
  else kind = "refresh";
  return { kind, useCursor: cursorsOn && kind !== "refresh", cursorsOn };
}
