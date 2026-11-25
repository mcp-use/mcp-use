/**
 * Namespace meta (PLAN.md §8.5, D23): `ev:{ns}:meta` is a plaintext envelope
 * `{v:1, layout:1, createdAt, cursorKey: <sealed>}` written put-if-absent.
 * Only `cursorKey` is sealed (AD = key + `#cursorKey`), so key-less readers
 * can read `layout`. `layout > 1` marks Events degraded (D67 rule 5).
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import type { Clock } from "../internal/clock.js";
import { LAYOUT_VERSION } from "../internal/layout.js";
import { fromBase64Url, toBase64Url } from "./keyring.js";
import type { Sealer } from "./seal.js";

/** The decoded namespace meta. */
export interface LoadedMeta {
  /** The layout written in the store. */
  layout: number;
  createdAt: number;
  /** 32 random bytes; empty when degraded or unopenable. */
  cursorKey: Uint8Array;
  /** `true` when `layout > 1` (written by a newer version): no writes. */
  degraded: boolean;
  /** `true` when this call created the record. */
  created: boolean;
}

/** Thrown when the meta exists but its cursor key cannot be opened (wrong keyring). */
export class MetaUnreadableError extends Error {
  constructor() {
    super("Events: ev:{ns}:meta cursorKey cannot be opened with this keyring");
    this.name = "MetaUnreadableError";
  }
}

/**
 * Reads `layout` without a keyring.
 *
 * @param storage - The store.
 * @param key - `keys.meta()`.
 * @returns The layout, or `null` when there is no meta yet.
 */
export async function readMetaLayout(
  storage: McpUseStorage,
  key: string
): Promise<number | null> {
  const got = await storage.read(key);
  if (!got) return null;
  try {
    const v = JSON.parse(got.value) as { layout?: unknown };
    return typeof v.layout === "number" ? v.layout : null;
  } catch {
    return null;
  }
}

/**
 * Loads the namespace meta, creating it put-if-absent on first use.
 *
 * @param storage - The store.
 * @param sealer - Seals the cursor key.
 * @param key - `keys.meta()`.
 * @param clock - Time and randomness.
 * @returns The meta.
 * @throws {@link MetaUnreadableError} when the cursor key does not open.
 */
export async function ensureMeta(
  storage: McpUseStorage,
  sealer: Sealer,
  key: string,
  clock: Clock
): Promise<LoadedMeta> {
  for (let i = 0; i < 3; i++) {
    const got = await storage.read(key);
    if (got) return decode(got.value, sealer, key, false);
    const cursorKey = clock.randomBytes(32);
    const record = {
      v: 1,
      layout: LAYOUT_VERSION,
      createdAt: clock.now(),
      cursorKey: await sealer.seal(`${key}#cursorKey`, toBase64Url(cursorKey)),
    };
    const text = JSON.stringify(record);
    if ((await storage.write(key, text, { ifVersion: null })) !== false) {
      return decode(text, sealer, key, true);
    }
  }
  throw new Error("Events: ev:{ns}:meta could not be created");
}

async function decode(
  text: string,
  sealer: Sealer,
  key: string,
  created: boolean
): Promise<LoadedMeta> {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const layout = typeof raw.layout === "number" ? raw.layout : 0;
  const createdAt = typeof raw.createdAt === "number" ? raw.createdAt : 0;
  if (layout > LAYOUT_VERSION) {
    return {
      layout,
      createdAt,
      cursorKey: new Uint8Array(0),
      degraded: true,
      created,
    };
  }
  const opened =
    typeof raw.cursorKey === "string"
      ? await sealer.open(`${key}#cursorKey`, raw.cursorKey)
      : undefined;
  const bytes = opened === undefined ? undefined : fromBase64Url(opened);
  if (!bytes || bytes.length !== 32) throw new MetaUnreadableError();
  return { layout, createdAt, cursorKey: bytes, degraded: false, created };
}
