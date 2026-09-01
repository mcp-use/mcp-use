import type {
  LaneConnectionInput,
  LaneConnectionKey,
  LaneConnectionRecord,
  LaneConnectionStore,
} from "./types.js";

/** In-memory store with a `size()` inspector for diagnostics. */
export type MemoryLaneConnectionStore = LaneConnectionStore & {
  /** Number of recorded connections. */
  size(): number;
};

function keyOf(key: LaneConnectionKey): string {
  return `${key.sub} ${key.jti}`;
}

/**
 * Process-local connection store. Correct for a single server instance and
 * for development; two replicas with separate memory stores disagree about
 * whether a credential is connected. The exchanged access token is not
 * retained because nothing reads it back.
 */
export function memoryLaneConnectionStore(): MemoryLaneConnectionStore {
  const rows = new Map<string, LaneConnectionRecord>();
  return {
    async get(key) {
      return rows.get(keyOf(key)) ?? null;
    },
    async put(key, value: LaneConnectionInput) {
      const { accessToken: _dropped, ...rest } = value;
      const record: LaneConnectionRecord = { ...rest, createdAt: Date.now() };
      rows.set(keyOf(key), record);
      return record;
    },
    async delete(key) {
      rows.delete(keyOf(key));
    },
    size() {
      return rows.size;
    },
  };
}

/**
 * Reads a connection and treats an expired one as absent.
 *
 * @internal
 */
export async function liveLaneConnection(
  store: LaneConnectionStore,
  key: LaneConnectionKey,
  nowMs: number = Date.now()
): Promise<LaneConnectionRecord | null> {
  const record = await store.get(key);
  if (record === null) return null;
  if (record.expiresAt !== undefined && record.expiresAt * 1000 <= nowMs) {
    return null;
  }
  return record;
}
