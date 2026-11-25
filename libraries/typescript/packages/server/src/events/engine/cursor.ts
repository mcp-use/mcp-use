/**
 * Cursor codec and the single cursor-resolution function (PLAN.md §8.8.2,
 * §8.8.3, D49). Format `c1.<epoch>.<seq36>.<mac16>` with
 * `mac = base64url(HMAC-SHA256(cursorKey, "c1\0" + name + "\0" + epoch + "\0" + seq))[0..16]`.
 * An unverifiable cursor resolves to the head with `truncated: true`; it is
 * never an error.
 *
 * @internal
 */

import { toBase64Url, utf8 } from "../store/keyring.js";

/** Regex every `c1` cursor matches. */
export const CURSOR_PATTERN =
  /^c1\.([a-z0-9]{12})\.([0-9a-z]+)\.([A-Za-z0-9_-]{16})$/;

const keyCache = new WeakMap<Uint8Array, Promise<CryptoKey>>();

function hmacKey(cursorKey: Uint8Array): Promise<CryptoKey> {
  let k = keyCache.get(cursorKey);
  if (!k) {
    k = globalThis.crypto.subtle.importKey(
      "raw",
      new Uint8Array(cursorKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    keyCache.set(cursorKey, k);
  }
  return k;
}

async function mac(
  cursorKey: Uint8Array,
  name: string,
  epoch: string,
  seq: number
): Promise<string> {
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    await hmacKey(cursorKey),
    utf8(`c1\0${name}\0${epoch}\0${seq}`)
  );
  return toBase64Url(new Uint8Array(sig)).slice(0, 16);
}

/**
 * Encodes a cursor for a log position.
 *
 * @param cursorKey - The namespace cursor key.
 * @param name - The event name.
 * @param epoch - The log epoch.
 * @param seq - The position ("after entry `seq`").
 * @returns The cursor string.
 */
export async function encodeCursor(
  cursorKey: Uint8Array,
  name: string,
  epoch: string,
  seq: number
): Promise<string> {
  return `c1.${epoch}.${seq.toString(36)}.${await mac(cursorKey, name, epoch, seq)}`;
}

/**
 * Decodes and verifies a cursor.
 *
 * @param cursorKey - The namespace cursor key.
 * @param name - The event name it must belong to.
 * @param cursor - The client-supplied cursor.
 * @returns The position, or `undefined` when the format or MAC is wrong.
 */
export async function decodeCursor(
  cursorKey: Uint8Array,
  name: string,
  cursor: string
): Promise<{ epoch: string; seq: number } | undefined> {
  const m = CURSOR_PATTERN.exec(cursor);
  if (!m) return undefined;
  const epoch = m[1]!;
  const seq = parseInt(m[2]!, 36);
  if (!Number.isSafeInteger(seq) || seq.toString(36) !== m[2]) return undefined;
  const expected = await mac(cursorKey, name, epoch, seq);
  return timingEqual(expected, m[3]!) ? { epoch, seq } : undefined;
}

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The current log bounds. */
export interface LogBounds {
  /** Current epoch, or `null` for a log that never had an append. */
  epoch: string | null;
  /** Oldest retained seq (`head + 1` when empty). */
  first: number;
  /** Last allocated seq (0 when empty). */
  head: number;
}

/** Inputs of {@link resolveCursor}. */
export interface ResolveCursorInput {
  cursorKey: Uint8Array;
  name: string;
  /** `null`/absent: start at the head. */
  cursor: string | null | undefined;
  bounds: LogBounds;
  /** `false` for `replay: false` events or profiles without replay cursors: cursor ignored. */
  replayable: boolean;
  /** Optional floor on append time. Ignored for null cursors and non-replayable events. */
  maxAgeMs?: number;
  now: number;
  /** Pages entries after `after` (needed only with `maxAgeMs`). */
  scan?: (
    after: number,
    limit: number
  ) => Promise<Array<{ seq: number; at: number }>>;
}

/** Outcome of {@link resolveCursor}. */
export interface ResolvedStart {
  /** The epoch of `seq`, or `null` for an empty log. */
  epoch: string | null;
  /** Start position: deliver entries with seq greater than this. */
  seq: number;
  truncated: boolean;
}

/**
 * Resolves a client cursor to a start position (the one function used by
 * poll, stream and webhook create).
 *
 * @param i - Cursor, bounds and options.
 * @returns The start position and `truncated`.
 */
export async function resolveCursor(
  i: ResolveCursorInput
): Promise<ResolvedStart> {
  const { bounds } = i;
  const head = { epoch: bounds.epoch, seq: bounds.head };
  if (i.cursor === null || i.cursor === undefined || !i.replayable) {
    return { ...head, truncated: false };
  }
  const pos = await decodeCursor(i.cursorKey, i.name, i.cursor);
  if (!pos) return { ...head, truncated: true };
  let seq: number;
  let truncated = false;
  if (bounds.epoch === null || pos.epoch !== bounds.epoch) {
    seq = bounds.first - 1;
    truncated = true;
  } else if (pos.seq > bounds.head) {
    return { ...head, truncated: true };
  } else if (pos.seq < bounds.first - 1) {
    seq = bounds.first - 1;
    truncated = true;
  } else {
    seq = pos.seq;
  }
  if (i.maxAgeMs !== undefined && i.scan) {
    const floor = i.now - i.maxAgeMs;
    let after = seq;
    scanning: for (;;) {
      const page = await i.scan(after, 100);
      if (page.length === 0) {
        if (after !== seq) truncated = true;
        seq = after;
        break;
      }
      for (const e of page) {
        if (e.at >= floor) {
          if (e.seq - 1 !== seq) truncated = true;
          seq = Math.max(seq, e.seq - 1);
          break scanning;
        }
        after = e.seq;
      }
    }
  }
  return { epoch: bounds.epoch, seq, truncated };
}
