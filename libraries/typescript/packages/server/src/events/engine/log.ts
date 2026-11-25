/**
 * The per-event durable log over `McpUseStorage` (PLAN.md §8.8, D49): sealed
 * `LogValue`s, one atomic `logAppend` per write, range reads that open and
 * decode entries.
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import type { LogValue } from "../internal/records.js";
import type { EventsKeys } from "../store/keys.js";
import type { Sealer } from "../store/seal.js";

/** Options of {@link EventLog.append}. */
export interface EventLogAppendOptions {
  /** Count cap: `max(replay.maxEvents, 10,000)`. */
  maxEvents: number;
  /** Full dedupe key and its TTL. */
  dedupe?: { key: string; ttlMs: number };
  /** Add the name to `fanout-due` (webhook mode available). */
  markFanout?: boolean;
  /** Publish on the wake channel. */
  notify?: boolean;
  now: number;
}

/** A decoded log page. */
export interface EventLogPage {
  /** Entries that opened; unopenable entries are skipped (`seq` still advances). */
  entries: Array<{ seq: number; value: LogValue }>;
  /** The highest seq returned by storage, opened or not. */
  lastSeq: number | null;
  epoch: string | null;
  first: number;
  head: number;
}

/** The log of one namespace. */
export interface EventLog {
  append(
    name: string,
    value: LogValue,
    o: EventLogAppendOptions
  ): Promise<
    | { duplicate: false; seq: number; epoch: string }
    | { duplicate: true; seq: number | null }
  >;
  range(
    name: string,
    after: number | null,
    limit: number
  ): Promise<EventLogPage>;
  trim(name: string, before: number): Promise<number>;
  remove(name: string): Promise<void>;
}

/**
 * Creates the log layer.
 *
 * @param d - Storage, key codec and sealer.
 * @returns The log.
 */
export function createEventLog(d: {
  storage: McpUseStorage;
  keys: EventsKeys;
  sealer: Sealer;
}): EventLog {
  const { storage, keys, sealer } = d;
  return {
    async append(name, value, o) {
      const key = keys.log(name);
      const sealed = await sealer.seal(key, JSON.stringify(value));
      return storage.logAppend(key, sealed, {
        maxEvents: o.maxEvents,
        ...(o.dedupe ? { dedupe: o.dedupe } : {}),
        ...(o.markFanout
          ? {
              mark: {
                index: keys.fanoutDue(),
                member: key.slice(keys.root.length + "log:".length),
                score: o.now,
              },
            }
          : {}),
        ...(o.notify && storage.signal ? { notify: keys.wake() } : {}),
      });
    },
    async range(name, after, limit) {
      const key = keys.log(name);
      const r = await storage.logRange(key, { after, limit });
      const entries: EventLogPage["entries"] = [];
      let lastSeq: number | null = null;
      for (const e of r.entries) {
        lastSeq = e.seq;
        const text = await sealer.open(key, e.value);
        if (text === undefined) continue;
        try {
          entries.push({ seq: e.seq, value: JSON.parse(text) as LogValue });
        } catch {
          /* undecodable entry: skipped */
        }
      }
      return { entries, lastSeq, epoch: r.epoch, first: r.first, head: r.head };
    },
    trim: (name, before) => storage.logTrim(keys.log(name), { before }),
    remove: (name) => storage.logDelete(keys.log(name)),
  };
}
