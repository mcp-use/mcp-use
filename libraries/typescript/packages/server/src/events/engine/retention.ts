/**
 * Log retention (PLAN.md §8.8.4, D49, D50): which prefix of a log may be
 * trimmed. `logAppend`'s `maxEvents` enforces the safety cap; this computes
 * the age/count cut used by the dispatcher and the sweeper.
 *
 * @internal
 */

import { EVENTS_DEFAULTS } from "../config.js";
import type { EventLog } from "./log.js";

/** Non-replayable tail window for push readers. */
export const NON_REPLAY_TAIL_MS = 2 * 60_000;

/**
 * The safety cap `max(replay.maxEvents, 10,000)`.
 *
 * @param replay - Resolved replay window, or `false`.
 * @returns The `maxEvents` passed to every append.
 */
export function hardCap(
  replay: false | { maxAgeMs: number; maxEvents: number }
): number {
  return Math.max(
    replay === false ? 0 : replay.maxEvents,
    EVENTS_DEFAULTS.replayHardCapMin
  );
}

/** Inputs of {@link computeTrimBefore}. */
export interface TrimInput {
  /** Entries from `first` onward (seq ascending, with append time). */
  entries: ReadonlyArray<{ seq: number; at: number }>;
  head: number;
  replay: false | { maxAgeMs: number; maxEvents: number };
  /** `fanout.through`, or `null` when no webhook mode is available (age and count alone decide). */
  dispatchedThrough: number | null;
  now: number;
}

/**
 * Computes the trim cut: every entry with `seq < before` may be removed.
 *
 * @param i - Entries, bounds and policy.
 * @returns `before`, or `null` when nothing is trimmable.
 */
export function computeTrimBefore(i: TrimInput): number | null {
  const dispatched = (seq: number): boolean =>
    i.dispatchedThrough === null || seq <= i.dispatchedThrough;
  let before: number | null = null;
  for (const e of i.entries) {
    let eligible: boolean;
    if (i.replay === false) {
      eligible = e.at < i.now - NON_REPLAY_TAIL_MS;
    } else {
      const tooOld = e.at < i.now - i.replay.maxAgeMs;
      const beyondCount = e.seq <= i.head - i.replay.maxEvents;
      eligible = tooOld || beyondCount;
    }
    if (!eligible || !dispatched(e.seq)) break;
    before = e.seq + 1;
  }
  return before;
}

/**
 * Reads the first page of a log and trims what retention allows.
 *
 * @param log - The log layer.
 * @param name - The event name.
 * @param o - Policy, dispatcher pointer and time.
 * @returns Entries removed.
 */
export async function applyRetention(
  log: EventLog,
  name: string,
  o: Omit<TrimInput, "entries" | "head"> & { pageSize?: number }
): Promise<number> {
  const page = await log.range(name, null, o.pageSize ?? 500);
  const before = computeTrimBefore({
    ...o,
    head: page.head,
    entries: page.entries.map((e) => ({ seq: e.seq, at: e.value.at })),
  });
  return before === null ? 0 : log.trim(name, before);
}
