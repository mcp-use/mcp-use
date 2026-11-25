/**
 * The emit path (PLAN.md §8.8.1): build the `LogValue`, enforce the size
 * limit on the largest possible body, and write it with one atomic
 * `logAppend` (dedupe `h(eventId ‖ JCS(to))`, entry, `fanout-due` mark, wake).
 *
 * @internal
 */

import { canonicalJson } from "@mcp-use/events-core";
import { EventsConfigError } from "../errors.js";
import type { Clock } from "../internal/clock.js";
import type { LogTarget, LogValue } from "../internal/records.js";
import { hashSegment } from "../store/keys.js";
import type { EventsKeys } from "../store/keys.js";
import type { EventLog } from "./log.js";

/** Largest body a profile may send. */
export const MAX_EVENT_BODY_BYTES = 262_144;
/** Emit dedupe window. */
export const EMIT_DEDUPE_TTL_MS = 24 * 60 * 60_000;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A ULID from the clock (time-ordered, 26 chars).
 *
 * @param clock - Time and randomness.
 * @returns The ULID.
 */
export function ulid(clock: Clock): string {
  let t = clock.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  const rnd = clock.randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[rnd[i]! % 32];
  return time + rand;
}

/**
 * A generated event id: `evt_<ulid>`, or `test_<ulid>` for admin test emits (D38).
 *
 * @param clock - Time and randomness.
 * @param test - Whether this is a test emit.
 * @returns The id.
 */
export function generateEventId(clock: Clock, test = false): string {
  return `${test ? "test" : "evt"}_${ulid(clock)}`;
}

/** Inputs of {@link buildEventEntry}. */
export interface EmitInput {
  name: string;
  /** Validated payload (payloadSchema output). */
  data: unknown;
  eventId?: string;
  timestamp?: Date | string;
  meta?: Record<string, unknown>;
  partition: string | null;
  principal?: string | readonly string[];
  subscriptionId?: string;
  test?: boolean;
}

/**
 * Builds the log value and checks its size.
 *
 * @param i - The emit.
 * @param clock - Time and id randomness.
 * @returns The entry.
 * @throws {@link EventsConfigError} `EVENT_PAYLOAD_TOO_LARGE` (nothing written).
 */
export function buildEventEntry(
  i: EmitInput,
  clock: Clock
): Extract<LogValue, { k: "e" }> {
  const now = clock.now();
  const id = i.eventId ?? generateEventId(clock, i.test === true);
  const ts =
    i.timestamp === undefined
      ? new Date(now).toISOString()
      : new Date(i.timestamp).toISOString();
  const to: LogTarget = {};
  if (i.principal !== undefined)
    to.principals =
      typeof i.principal === "string" ? [i.principal] : [...i.principal];
  if (i.subscriptionId !== undefined) to.subscriptionId = i.subscriptionId;
  const entry: Extract<LogValue, { k: "e" }> = {
    v: 1,
    k: "e",
    id,
    ts,
    at: now,
    data: i.data,
    partition: i.partition,
  };
  if (i.meta !== undefined) entry.meta = i.meta;
  if (Object.keys(to).length > 0) entry.to = to;
  if (i.test) entry.test = true;
  const bytes = largestBodyBytes(i.name, entry);
  if (bytes > MAX_EVENT_BODY_BYTES) {
    throw new EventsConfigError(
      "EVENT_PAYLOAD_TOO_LARGE",
      `Event "${i.name}" body would be ${bytes} bytes; the limit is ${MAX_EVENT_BODY_BYTES}`,
      { name: i.name, bytes, limit: MAX_EVENT_BODY_BYTES }
    );
  }
  return entry;
}

/**
 * Bytes of the largest body any profile could send for an entry: the
 * occurrence with a 64-character cursor, a subscription id and the
 * JSON-RPC envelope.
 *
 * @param name - The event name.
 * @param entry - The entry.
 * @returns UTF-8 byte length.
 */
export function largestBodyBytes(
  name: string,
  entry: Extract<LogValue, { k: "e" }>
): number {
  const body = {
    jsonrpc: "2.0",
    method: "notifications/events/event",
    params: {
      subscriptionId: `sub_${"x".repeat(22)}`,
      name,
      eventId: entry.id,
      timestamp: entry.ts,
      data: entry.data,
      cursor: "c".repeat(64),
      ...(entry.meta ? { _meta: entry.meta } : {}),
    },
  };
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

/**
 * The dedupe digest `h(eventId ‖ JCS(to))` (D57).
 *
 * @param eventId - The raw id.
 * @param to - The target, if any.
 * @returns The 22-char digest.
 */
export function dedupeDigest(
  eventId: string,
  to: LogTarget | undefined
): Promise<string> {
  return hashSegment(`${eventId}\u0000${canonicalJson(to ?? null)}`);
}

/** Dependencies of {@link appendEvent}. */
export interface AppendEventDeps {
  log: EventLog;
  keys: EventsKeys;
  clock: Clock;
}

/**
 * Writes an entry with one atomic append.
 *
 * @param d - Log, keys and clock.
 * @param name - The event name.
 * @param entry - From {@link buildEventEntry}.
 * @param o - Cap, whether a dispatcher should run, whether to notify.
 * @returns The emit result and the seq/epoch when appended.
 */
export async function appendEvent(
  d: AppendEventDeps,
  name: string,
  entry: Extract<LogValue, { k: "e" }>,
  o: { maxEvents: number; webhook: boolean; notify: boolean }
): Promise<{
  eventId: string;
  duplicate: boolean;
  seq: number | null;
  epoch: string | null;
}> {
  const digest = await dedupeDigest(entry.id, entry.to);
  const r = await d.log.append(name, entry, {
    maxEvents: o.maxEvents,
    dedupe: { key: d.keys.emitDedupe(name, digest), ttlMs: EMIT_DEDUPE_TTL_MS },
    markFanout: o.webhook,
    notify: o.notify,
    now: entry.at,
  });
  return r.duplicate
    ? { eventId: entry.id, duplicate: true, seq: r.seq, epoch: null }
    : { eventId: entry.id, duplicate: false, seq: r.seq, epoch: r.epoch };
}
