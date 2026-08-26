import {
  createOAuthProxyEncryptionCodec,
  createOAuthProxyPlaintextCodec,
  type OAuthProxyEncryptionOptions,
  type OAuthProxyPayloadCodec,
} from "./encryption.js";

const MAX_KEY_BYTES = 1024;
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_STORED_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_TRANSACTION_KEYS = 64;
const MAX_TRANSACTION_KEY_DECLARATIONS = 256;
const textEncoder = new TextEncoder();

/** @internal Persistence and at-rest secret-protection guarantees of a proxy store. */
export interface OAuthProxyStoreCapabilities {
  /** Whether values survive process restart. */
  readonly persistence: "process-local" | "persistent";
  /** Whether the store itself encrypts secret payloads before persistence. */
  readonly secretProtection: "none" | "store-encrypted";
}

/** @internal Result of creating a new non-overwriting proxy store entry. */
export type OAuthProxyStoreCreateResult =
  | { readonly status: "created" }
  | { readonly status: "conflict" };

/** @internal Result of reading a proxy store entry. */
export type OAuthProxyStoreReadResult =
  | { readonly status: "found"; readonly payload: Uint8Array }
  | { readonly status: "missing" }
  | { readonly status: "replayed" };

/** @internal Result of atomically consuming a one-time proxy store entry. */
export type OAuthProxyStoreConsumeResult =
  | { readonly status: "consumed"; readonly payload: Uint8Array }
  | { readonly status: "missing" }
  | { readonly status: "replayed" };

/** @internal Result of replacing an existing live proxy store entry. */
export type OAuthProxyStoreReplaceResult =
  | { readonly status: "replaced" }
  | { readonly status: "missing" }
  | { readonly status: "replayed" };

/** @internal Operations available inside one serializable proxy store transaction. */
export interface OAuthProxyStoreTransaction {
  /** Creates a declared key without overwriting a live value or tombstone. */
  create(
    key: string,
    payload: Uint8Array,
    expiresAt: number
  ): Promise<OAuthProxyStoreCreateResult>;
  /** Reads a declared key without consuming it. */
  read(key: string): Promise<OAuthProxyStoreReadResult>;
  /** Replaces a declared live value but never creates or resurrects an entry. */
  replace(
    key: string,
    payload: Uint8Array,
    expiresAt: number
  ): Promise<OAuthProxyStoreReplaceResult>;
  /** Replaces a declared live entry with a tombstone and returns its payload once. */
  consume(key: string): Promise<OAuthProxyStoreConsumeResult>;
}

/**
 * @internal Byte-oriented storage boundary for OAuth proxy secrets. Implementations
 * must make all operations serializable across every process sharing the store.
 */
export interface OAuthProxyStore extends OAuthProxyStoreTransaction {
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

/** @internal Optional store and SDK encryption inputs resolved by the proxy wrapper. */
export interface OAuthProxyStoreResolutionOptions {
  /** Custom or built-in store. Omission creates a fresh private process-local store. */
  readonly store?: OAuthProxyStore;
  /** Optional SDK-managed AES-256-GCM keyring for payload encryption. */
  readonly encryption?: OAuthProxyEncryptionOptions;
}

/** @internal Validated store plus details of the protection applied at its boundary. */
export interface ResolvedOAuthProxyStore {
  /** Store used by the proxy; SDK encryption is applied transparently when configured. */
  readonly store: OAuthProxyStore;
  /** Validated capabilities declared by the underlying store. */
  readonly capabilities: OAuthProxyStoreCapabilities;
  /** Whether this resolver encrypted payloads before handing them to the store. */
  readonly sdkEncryption: boolean;
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
  const underlying = options.store ?? inMemoryOAuthStore();
  const capabilities = validateStore(underlying);

  if (
    capabilities.persistence === "persistent" &&
    capabilities.secretProtection === "none" &&
    options.encryption === undefined
  ) {
    throw new TypeError(
      "Persistent OAuth proxy stores without store encryption require SDK encryption"
    );
  }

  const codec =
    options.encryption === undefined
      ? createOAuthProxyPlaintextCodec()
      : createOAuthProxyEncryptionCodec(options.encryption);
  const sdkEncryption = options.encryption !== undefined;

  return {
    capabilities,
    sdkEncryption,
    store: codecStore(underlying, capabilities, codec),
  };
}

type InMemoryEntry =
  | {
      readonly kind: "live";
      readonly payload: Uint8Array;
      readonly expiresAt: number;
    }
  | { readonly kind: "tombstone"; readonly expiresAt: number };

function inMemoryOAuthStore(now: () => number = Date.now): OAuthProxyStore {
  const entries = new Map<string, InMemoryEntry>();
  const mutex = asyncMutex();

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
      const staged = cloneEntries(entries);
      cleanupExpired(staged, now());
      const result = await work(mapTransaction(staged, declared, now));
      entries.clear();
      for (const [key, entry] of staged) {
        entries.set(key, cloneEntry(entry));
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
    create(key, payload, expiresAt) {
      return runTransaction([key], (transaction) =>
        transaction.create(key, payload, expiresAt)
      );
    },
    read(key) {
      return runTransaction([key], (transaction) => transaction.read(key));
    },
    replace(key, payload, expiresAt) {
      return runTransaction([key], (transaction) =>
        transaction.replace(key, payload, expiresAt)
      );
    },
    consume(key) {
      return runTransaction([key], (transaction) => transaction.consume(key));
    },
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
      assertStoredPayload(payload);
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
      assertStoredPayload(payload);
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

function codecStore(
  underlying: OAuthProxyStore,
  capabilities: OAuthProxyStoreCapabilities,
  codec: OAuthProxyPayloadCodec
): OAuthProxyStore {
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
    const declared = new Set(canonicalKeys);
    return underlying.transaction(canonicalKeys, (transaction) =>
      work(codecTransaction(transaction, declared, codec))
    );
  };

  return {
    capabilities,
    transaction: runTransaction,
    create(key, payload, expiresAt) {
      return runTransaction([key], (transaction) =>
        transaction.create(key, payload, expiresAt)
      );
    },
    read(key) {
      return runTransaction([key], (transaction) => transaction.read(key));
    },
    replace(key, payload, expiresAt) {
      return runTransaction([key], (transaction) =>
        transaction.replace(key, payload, expiresAt)
      );
    },
    consume(key) {
      return runTransaction([key], (transaction) => transaction.consume(key));
    },
  };
}

function codecTransaction(
  underlying: OAuthProxyStoreTransaction,
  declared: ReadonlySet<string>,
  codec: OAuthProxyPayloadCodec
): OAuthProxyStoreTransaction {
  return {
    async create(key, payload, expiresAt) {
      assertDeclaredKey(key, declared);
      assertPayload(payload);
      assertFutureExpiry(expiresAt, Date.now());
      const encoded = await codec.encode(key, payload);
      const result: unknown = await underlying.create(key, encoded, expiresAt);
      validateCreateResult(result);
      return result;
    },
    async read(key) {
      assertDeclaredKey(key, declared);
      const result: unknown = await underlying.read(key);
      validateReadResult(result);
      if (result.status !== "found") {
        return result;
      }
      const payload = await codec.decode(key, result.payload);
      assertPayload(payload);
      return {
        status: "found",
        payload,
      };
    },
    async replace(key, payload, expiresAt) {
      assertDeclaredKey(key, declared);
      assertPayload(payload);
      assertFutureExpiry(expiresAt, Date.now());
      const encoded = await codec.encode(key, payload);
      const result: unknown = await underlying.replace(key, encoded, expiresAt);
      validateReplaceResult(result);
      return result;
    },
    async consume(key) {
      assertDeclaredKey(key, declared);
      const result: unknown = await underlying.consume(key);
      validateConsumeResult(result);
      if (result.status !== "consumed") {
        return result;
      }
      const payload = await codec.decode(key, result.payload);
      assertPayload(payload);
      return {
        status: "consumed",
        payload,
      };
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

function cloneEntries(
  entries: ReadonlyMap<string, InMemoryEntry>
): Map<string, InMemoryEntry> {
  return new Map([...entries].map(([key, entry]) => [key, cloneEntry(entry)]));
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
): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(key);
    }
  }
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
  assertStoredPayload(value.payload);
}

function validateReplaceResult(
  value: unknown
): asserts value is OAuthProxyStoreReplaceResult {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    (value.status !== "replaced" &&
      value.status !== "missing" &&
      value.status !== "replayed")
  ) {
    throw new TypeError("OAuth proxy store returned an invalid replace result");
  }
}

function validateConsumeResult(
  value: unknown
): asserts value is OAuthProxyStoreConsumeResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    throw new TypeError("OAuth proxy store returned an invalid consume result");
  }
  if (value.status === "missing" || value.status === "replayed") {
    return;
  }
  if (
    value.status !== "consumed" ||
    !("payload" in value) ||
    !(value.payload instanceof Uint8Array)
  ) {
    throw new TypeError("OAuth proxy store returned an invalid consume result");
  }
  assertStoredPayload(value.payload);
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
  if (
    typeof store.create !== "function" ||
    typeof store.read !== "function" ||
    typeof store.replace !== "function" ||
    typeof store.consume !== "function" ||
    typeof store.transaction !== "function"
  ) {
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

function assertStoredPayload(payload: unknown): asserts payload is Uint8Array {
  if (!(payload instanceof Uint8Array)) {
    throw new TypeError("OAuth proxy store payload must be a Uint8Array");
  }
  if (payload.byteLength > MAX_STORED_PAYLOAD_BYTES) {
    throw new TypeError(
      `OAuth proxy serialized payload must not exceed ${MAX_STORED_PAYLOAD_BYTES} bytes`
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
