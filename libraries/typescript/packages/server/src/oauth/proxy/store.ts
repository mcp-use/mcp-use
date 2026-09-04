const MAX_KEY_BYTES = 1024;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_TRANSACTION_KEYS = 64;
const MAX_TRANSACTION_KEY_DECLARATIONS = 256;
const MAX_IN_MEMORY_ENTRIES = 10_000;
const MAX_IN_MEMORY_PAYLOAD_BYTES = 64 * 1024 * 1024;
const textEncoder = new TextEncoder();

/** Persistence and at-rest secret-protection guarantees of an OAuth proxy store. */
export interface OAuthProxyStoreCapabilities {
  /** Whether values survive process restart. */
  readonly persistence: "process-local" | "persistent";
  /** Whether the store itself encrypts secret payloads before persistence. */
  readonly secretProtection: "none" | "store-encrypted";
}

/** Result of creating a new non-overwriting OAuth proxy store entry. */
export type OAuthProxyStoreCreateResult =
  | {
      /** A new entry was stored without overwriting existing unexpired state. */
      readonly status: "created";
    }
  | {
      /** An unexpired live entry or replay tombstone already owns the key. */
      readonly status: "conflict";
    };

/** Result of reading an OAuth proxy store entry. */
export type OAuthProxyStoreReadResult =
  | {
      /** The key contains an unexpired live entry. */
      readonly status: "found";
      /** Independent copy of the entry's bytes; callers may mutate their copy. */
      readonly payload: Uint8Array;
    }
  | {
      /** The key does not exist or its retention period has expired. */
      readonly status: "missing";
    }
  | {
      /** The key was consumed and its unexpired replay tombstone remains. */
      readonly status: "replayed";
    };

/** Result of atomically consuming a one-time OAuth proxy store entry. */
export type OAuthProxyStoreConsumeResult =
  | {
      /** This operation exclusively consumed the live entry and left a tombstone. */
      readonly status: "consumed";
      /** Independent copy of the bytes returned to the one successful consumer. */
      readonly payload: Uint8Array;
    }
  | {
      /** No unexpired entry was available to consume. */
      readonly status: "missing";
    }
  | {
      /** A previous consumer already used this key during its retention period. */
      readonly status: "replayed";
    };

/** Result of replacing an existing live OAuth proxy store entry. */
export type OAuthProxyStoreReplaceResult =
  | {
      /** The existing unexpired live entry was updated atomically. */
      readonly status: "replaced";
    }
  | {
      /** No unexpired entry existed, so the operation did not create one. */
      readonly status: "missing";
    }
  | {
      /** A replay tombstone prevented the operation from resurrecting the key. */
      readonly status: "replayed";
    };

/** Operations available inside one serializable OAuth proxy store transaction. */
export interface OAuthProxyStoreTransaction {
  /** Creates a declared key without overwriting an unexpired live value or tombstone. */
  create(
    key: string,
    payload: Uint8Array,
    expiresAt: number
  ): Promise<OAuthProxyStoreCreateResult>;
  /** Reads a declared key without consuming it; expired entries must return `missing`. */
  read(key: string): Promise<OAuthProxyStoreReadResult>;
  /** Replaces a declared unexpired live value but never creates or resurrects an entry. */
  replace(
    key: string,
    payload: Uint8Array,
    expiresAt: number
  ): Promise<OAuthProxyStoreReplaceResult>;
  /**
   * Consumes an unexpired live entry exactly once, retaining its tombstone through
   * the original expiry. Expired entries must return `missing`, never payloads.
   */
  consume(key: string): Promise<OAuthProxyStoreConsumeResult>;
}

/**
 * Byte-oriented storage boundary for OAuth proxy secrets. Implementations must
 * make all operations serializable across every process sharing the store.
 */
export interface OAuthProxyStore {
  /** Explicit persistence and secret-protection guarantees. */
  readonly capabilities: OAuthProxyStoreCapabilities;
  /**
   * Runs work atomically for the declared keys. Implementations must canonically
   * order and deduplicate keys before locking, reject undeclared-key access, and
   * completely roll back when `work` throws.
   */
  transaction<T>(
    keys: readonly string[],
    work: (transaction: OAuthProxyStoreTransaction) => T | Promise<T>
  ): Promise<T>;
}

/** @internal Optional store input resolved by the proxy wrapper. */
export interface OAuthProxyStoreResolutionOptions {
  /** Custom or built-in store. Omission creates a fresh private process-local store. */
  readonly store?: OAuthProxyStore;
}

/** @internal Validated store and its declared storage capabilities. */
export interface ResolvedOAuthProxyStore {
  /** Store used by the proxy. */
  readonly store: OAuthProxyStore;
  /** Validated capabilities declared by the store. */
  readonly capabilities: OAuthProxyStoreCapabilities;
}

/**
 * @internal Resolves an optional OAuth proxy store without ever allowing persistent
 * plaintext secrets. Every omitted-store call receives an isolated in-memory map.
 */
export function resolveOAuthProxyStore(
  options: OAuthProxyStoreResolutionOptions = {}
): ResolvedOAuthProxyStore {
  if (typeof options !== "object" || options === null) {
    throw new TypeError(
      "OAuth proxy store resolution options must be an object"
    );
  }
  const underlying =
    options.store === undefined ? inMemoryOAuthStore() : options.store;
  const capabilities = validateStore(underlying);

  if (
    capabilities.persistence === "persistent" &&
    capabilities.secretProtection !== "store-encrypted"
  ) {
    throw new TypeError(
      'Persistent OAuth proxy stores must encrypt secrets and declare secretProtection: "store-encrypted"'
    );
  }

  return {
    capabilities,
    store: underlying,
  };
}

/** @internal Creates one entry through the store's transactional boundary. */
export async function createOAuthProxyStoreEntry(
  store: OAuthProxyStore,
  key: string,
  payload: Uint8Array,
  expiresAt: number
): Promise<OAuthProxyStoreCreateResult> {
  assertKey(key);
  assertPayload(payload);
  assertFutureExpiry(expiresAt, Date.now());
  const snapshot = Uint8Array.from(payload);
  return store.transaction([key], async (transaction) => {
    const result: unknown = await transaction.create(key, snapshot, expiresAt);
    validateCreateResult(result);
    return result;
  });
}

/** @internal Reads one entry through the store's transactional boundary. */
export async function readOAuthProxyStoreEntry(
  store: OAuthProxyStore,
  key: string
): Promise<OAuthProxyStoreReadResult> {
  assertKey(key);
  return store.transaction([key], async (transaction) => {
    const result: unknown = await transaction.read(key);
    validateReadResult(result);
    return result.status === "found"
      ? { status: "found", payload: Uint8Array.from(result.payload) }
      : result;
  });
}

type InMemoryEntry =
  | {
      readonly kind: "live";
      readonly payload: Uint8Array;
      readonly expiresAt: number;
    }
  | { readonly kind: "tombstone"; readonly expiresAt: number };

/**
 * Creates an isolated process-local OAuth proxy store.
 *
 * Sessions are lost when the process restarts and are not shared with other
 * processes or server instances. Because values never leave the process, at-rest
 * encryption is not required. Capacity is limited to 10,000 entries
 * and 64 MiB of payload bytes; exhausted capacity rejects writes. Expired values
 * are pruned on access or a capacity sweep, not by a background timer. Production
 * replicas need a shared, serializable store with expiry enforcement.
 */
export function inMemoryOAuthStore(): OAuthProxyStore {
  const now = Date.now;
  const entries = new Map<string, InMemoryEntry>();
  const mutex = asyncMutex();
  let storedPayloadBytes = 0;

  const runTransaction = async <T>(
    keys: readonly string[],
    work: (transaction: OAuthProxyStoreTransaction) => T | Promise<T>
  ): Promise<T> => {
    const canonicalKeys = canonicalizeTransactionKeys(keys);
    if (typeof work !== "function") {
      throw new TypeError(
        "OAuth proxy store transaction work must be a function"
      );
    }
    return mutex(async () => {
      const declared = new Set(canonicalKeys);
      const staged = new Map<string, InMemoryEntry>();
      const transactionStartedAt = now();
      for (const key of canonicalKeys) {
        const entry = entries.get(key);
        if (entry !== undefined && entry.expiresAt > transactionStartedAt) {
          staged.set(key, cloneEntry(entry));
        }
      }
      const result = await work(mapTransaction(staged, declared, now));

      const commitTime = now();
      cleanupExpired(staged, commitTime);
      let projected = projectedInMemoryUsage(
        entries,
        staged,
        canonicalKeys,
        storedPayloadBytes
      );
      if (
        projected.entries > MAX_IN_MEMORY_ENTRIES ||
        projected.payloadBytes > MAX_IN_MEMORY_PAYLOAD_BYTES
      ) {
        storedPayloadBytes -= cleanupExpired(entries, commitTime);
        projected = projectedInMemoryUsage(
          entries,
          staged,
          canonicalKeys,
          storedPayloadBytes
        );
      }
      if (
        projected.entries > MAX_IN_MEMORY_ENTRIES ||
        projected.payloadBytes > MAX_IN_MEMORY_PAYLOAD_BYTES
      ) {
        throw new RangeError("OAuth proxy in-memory store capacity exceeded");
      }

      for (const key of canonicalKeys) {
        const previous = entries.get(key);
        if (previous !== undefined) {
          storedPayloadBytes -= entryPayloadBytes(previous);
          entries.delete(key);
        }
        const next = staged.get(key);
        if (next !== undefined) {
          const snapshot = cloneEntry(next);
          entries.set(key, snapshot);
          storedPayloadBytes += entryPayloadBytes(snapshot);
        }
      }
      return result;
    });
  };

  return {
    capabilities: {
      persistence: "process-local",
      secretProtection: "none",
    },
    transaction: runTransaction,
  };
}

function mapTransaction(
  entries: Map<string, InMemoryEntry>,
  declared: ReadonlySet<string>,
  now: () => number
): OAuthProxyStoreTransaction {
  const current = (key: string): InMemoryEntry | undefined => {
    assertDeclaredKey(key, declared);
    const entry = entries.get(key);
    if (entry !== undefined && entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    async create(key, payload, expiresAt) {
      assertDeclaredKey(key, declared);
      assertPayload(payload);
      assertFutureExpiry(expiresAt, now());
      if (current(key) !== undefined) {
        return { status: "conflict" };
      }
      entries.set(key, {
        kind: "live",
        payload: Uint8Array.from(payload),
        expiresAt,
      });
      return { status: "created" };
    },
    async read(key) {
      const entry = current(key);
      if (entry === undefined) {
        return { status: "missing" };
      }
      if (entry.kind === "tombstone") {
        return { status: "replayed" };
      }
      return { status: "found", payload: Uint8Array.from(entry.payload) };
    },
    async replace(key, payload, expiresAt) {
      assertDeclaredKey(key, declared);
      assertPayload(payload);
      assertFutureExpiry(expiresAt, now());
      const entry = current(key);
      if (entry === undefined) {
        return { status: "missing" };
      }
      if (entry.kind === "tombstone") {
        return { status: "replayed" };
      }
      entries.set(key, {
        kind: "live",
        payload: Uint8Array.from(payload),
        expiresAt,
      });
      return { status: "replaced" };
    },
    async consume(key) {
      const entry = current(key);
      if (entry === undefined) {
        return { status: "missing" };
      }
      if (entry.kind === "tombstone") {
        return { status: "replayed" };
      }
      entries.set(key, { kind: "tombstone", expiresAt: entry.expiresAt });
      return { status: "consumed", payload: Uint8Array.from(entry.payload) };
    },
  };
}

function canonicalizeTransactionKeys(
  keys: readonly string[]
): readonly string[] {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new TypeError("OAuth proxy store transaction keys must be non-empty");
  }
  if (keys.length > MAX_TRANSACTION_KEY_DECLARATIONS) {
    throw new TypeError(
      `OAuth proxy store transactions support at most ${MAX_TRANSACTION_KEY_DECLARATIONS} key declarations`
    );
  }
  const unique = new Set<string>();
  for (const key of keys as readonly unknown[]) {
    assertKey(key);
    unique.add(key);
  }
  if (unique.size > MAX_TRANSACTION_KEYS) {
    throw new TypeError(
      `OAuth proxy store transactions support at most ${MAX_TRANSACTION_KEYS} keys`
    );
  }
  return [...unique].sort();
}

function asyncMutex(): <T>(work: () => T | Promise<T>) => Promise<T> {
  let tail = Promise.resolve();
  return async <T>(work: () => T | Promise<T>): Promise<T> => {
    const previous = tail;
    let release = (): void => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

function cloneEntry(entry: InMemoryEntry): InMemoryEntry {
  return entry.kind === "live"
    ? {
        kind: "live",
        payload: Uint8Array.from(entry.payload),
        expiresAt: entry.expiresAt,
      }
    : { kind: "tombstone", expiresAt: entry.expiresAt };
}

function cleanupExpired(
  entries: Map<string, InMemoryEntry>,
  now: number
): number {
  let removedPayloadBytes = 0;
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      removedPayloadBytes += entryPayloadBytes(entry);
      entries.delete(key);
    }
  }
  return removedPayloadBytes;
}

function projectedInMemoryUsage(
  entries: ReadonlyMap<string, InMemoryEntry>,
  staged: ReadonlyMap<string, InMemoryEntry>,
  keys: readonly string[],
  storedPayloadBytes: number
): { readonly entries: number; readonly payloadBytes: number } {
  let entryCount = entries.size;
  let payloadBytes = storedPayloadBytes;
  for (const key of keys) {
    const previous = entries.get(key);
    if (previous !== undefined) {
      entryCount -= 1;
      payloadBytes -= entryPayloadBytes(previous);
    }
    const next = staged.get(key);
    if (next !== undefined) {
      entryCount += 1;
      payloadBytes += entryPayloadBytes(next);
    }
  }
  return { entries: entryCount, payloadBytes };
}

function entryPayloadBytes(entry: InMemoryEntry): number {
  return entry.kind === "live" ? entry.payload.byteLength : 0;
}

function validateCreateResult(
  value: unknown
): asserts value is OAuthProxyStoreCreateResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    (value.status !== "created" && value.status !== "conflict")
  ) {
    throw new TypeError("OAuth proxy store returned an invalid create result");
  }
}

function validateReadResult(
  value: unknown
): asserts value is OAuthProxyStoreReadResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    throw new TypeError("OAuth proxy store returned an invalid read result");
  }
  if (value.status === "missing" || value.status === "replayed") {
    return;
  }
  if (
    value.status !== "found" ||
    !("payload" in value) ||
    !(value.payload instanceof Uint8Array)
  ) {
    throw new TypeError("OAuth proxy store returned an invalid read result");
  }
  assertPayload(value.payload);
}

function validateStore(store: OAuthProxyStore): OAuthProxyStoreCapabilities {
  if (typeof store !== "object" || store === null) {
    throw new TypeError("OAuth proxy store must be an object");
  }
  const capabilities = store.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) {
    throw new TypeError("OAuth proxy store capabilities must be an object");
  }
  if (
    capabilities.persistence !== "process-local" &&
    capabilities.persistence !== "persistent"
  ) {
    throw new TypeError("OAuth proxy store persistence capability is invalid");
  }
  if (
    capabilities.secretProtection !== "none" &&
    capabilities.secretProtection !== "store-encrypted"
  ) {
    throw new TypeError(
      "OAuth proxy store secretProtection capability is invalid"
    );
  }
  if (typeof store.transaction !== "function") {
    throw new TypeError("OAuth proxy store methods are invalid");
  }
  return Object.freeze({
    persistence: capabilities.persistence,
    secretProtection: capabilities.secretProtection,
  });
}

function assertDeclaredKey(
  key: unknown,
  declared: ReadonlySet<string>
): string {
  assertKey(key);
  if (!declared.has(key)) {
    throw new TypeError(
      `OAuth proxy store transaction key was not declared: ${key}`
    );
  }
  return key;
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("OAuth proxy store key must be a non-empty string");
  }
  if (textEncoder.encode(key).byteLength > MAX_KEY_BYTES) {
    throw new TypeError(
      `OAuth proxy store key must not exceed ${MAX_KEY_BYTES} UTF-8 bytes`
    );
  }
}

function assertPayload(payload: unknown): asserts payload is Uint8Array {
  if (!(payload instanceof Uint8Array)) {
    throw new TypeError("OAuth proxy store payload must be a Uint8Array");
  }
  if (payload.byteLength > MAX_PAYLOAD_BYTES) {
    throw new TypeError(
      `OAuth proxy store payload must not exceed ${MAX_PAYLOAD_BYTES} bytes`
    );
  }
}

function assertFutureExpiry(expiresAt: number, now: number): void {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    throw new TypeError(
      "OAuth proxy store expiry must be a finite epoch timestamp"
    );
  }
  if (expiresAt <= now) {
    throw new TypeError("OAuth proxy store expiry must be in the future");
  }
}
