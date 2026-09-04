import { Buffer } from "node:buffer";
import { createClient } from "redis";

/** A key used to encrypt newly written state and decrypt rotated state. */
export type OAuthProxyEncryptionKey = {
  /** Stable non-secret key identifier stored in the envelope. */
  id: string;
  /** Exactly 32 bytes for AES-256-GCM. */
  key: Uint8Array;
};

/**
 * Durable state boundary used by the hosted OAuth BFF.
 *
 * Values must never be logged by an implementation. `setIfNewer` is optional
 * for small custom stores; the Redis implementation uses WATCH/MULTI so an
 * older replica cannot overwrite newer state. `ready` is called during
 * application startup and performs a real connectivity check.
 */
export interface OAuthProxyStateStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  setIfNewer?<T>(key: string, value: T, ttlMs?: number): Promise<boolean>;
  delete(key: string): Promise<void>;
  ready?(): Promise<void>;
  close?(): Promise<void>;
}

type StoredValue = { value: unknown; expiresAt: number };
const MAX_MEMORY_ENTRIES = 2_000;
const MEMORY_CLEANUP_INTERVAL_MS = 60_000;

/** Process-local fallback for local development and unit tests. */
export function createMemoryOAuthProxyStateStore(): OAuthProxyStateStore {
  const values = new Map<string, StoredValue>();
  const cleanup = () => {
    const now = Date.now();
    for (const [key, entry] of values) {
      if (entry.expiresAt <= now) values.delete(key);
    }
    while (values.size > MAX_MEMORY_ENTRIES) {
      const oldest = values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      values.delete(oldest);
    }
  };
  const timer = setInterval(cleanup, MEMORY_CLEANUP_INTERVAL_MS);
  timer.unref?.();

  const store: OAuthProxyStateStore = {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = values.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        values.delete(key);
        return undefined;
      }
      return structuredClone(entry.value) as T;
    },
    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      values.set(key, {
        value: structuredClone(value),
        expiresAt:
          ttlMs === undefined || !Number.isFinite(ttlMs)
            ? Number.POSITIVE_INFINITY
            : Date.now() + Math.max(1, Math.ceil(ttlMs)),
      });
      cleanup();
    },
    async setIfNewer<T>(key: string, value: T, ttlMs?: number) {
      const current = values.get(key);
      if (current && current.expiresAt <= Date.now()) {
        values.delete(key);
      }
      if (
        current &&
        current.expiresAt > Date.now() &&
        compareStateVersion(current.value, value) >= 0
      ) {
        return false;
      }
      values.set(key, {
        value: structuredClone(value),
        expiresAt:
          ttlMs === undefined || !Number.isFinite(ttlMs)
            ? Number.POSITIVE_INFINITY
            : Date.now() + Math.max(1, Math.ceil(ttlMs)),
      });
      cleanup();
      return true;
    },
    async delete(key: string): Promise<void> {
      values.delete(key);
    },
    async ready(): Promise<void> {
      // The memory store is always ready.
    },
    async close(): Promise<void> {
      clearInterval(timer);
      values.clear();
    },
  };
  return store;
}

/**
 * Redis-backed store for hosted Inspector deployments.
 *
 * State is encrypted with AES-256-GCM before persistence. New writes use the
 * primary key and reads accept the primary plus any explicitly supplied old
 * keys, which permits key rotation without exposing credentials. Redis is
 * connected lazily for library callers, while `ready()` performs connect +
 * PING for standalone startup readiness.
 */
export function createRedisOAuthProxyStateStore(options: {
  url: string;
  encryptionKey: Uint8Array;
  encryptionKeyId?: string;
  decryptionKeys?: readonly OAuthProxyEncryptionKey[];
  keyPrefix?: string;
  shutdownTimeoutMs?: number;
}): OAuthProxyStateStore {
  if (!options.url) throw new TypeError("Redis URL is required");
  const keys = normalizeEncryptionKeys({
    id: options.encryptionKeyId,
    key: options.encryptionKey,
    previous: options.decryptionKeys,
  });
  const client = createClient({ url: options.url });
  // Redis requires an error listener. Do not print diagnostics because a
  // client error can contain the connection URL and its credentials.
  client.on("error", () => undefined);
  const keyPrefix = options.keyPrefix ?? "mcp-use:inspector:oauth:";
  const shutdownTimeoutMs = Math.max(1, options.shutdownTimeoutMs ?? 2_000);
  let connecting: Promise<void> | undefined;
  // WATCH state is connection-scoped. Keep one duplicate for all CAS work and
  // serialize its transactions in-process; WATCH/MULTI still arbitrates with
  // writers from other replicas without opening a socket per request.
  const transactionClient = client.duplicate();
  transactionClient.on("error", () => undefined);
  let transactionConnecting: Promise<void> | undefined;
  let transactionTail = Promise.resolve();
  let closing = false;

  const connectAndPing = async (): Promise<void> => {
    if (closing) throw new Error("OAuth state store is closed");
    if (!client.isOpen) await client.connect();
    // A disconnected node-redis client may remain open but not ready while it
    // is reconnecting. PING is the readiness gate and is intentionally not
    // replaced by isOpen (which only means a socket was opened).
    const result = await client.ping();
    if (result !== "PONG") throw new Error("Redis readiness check failed");
  };
  const ready = async (): Promise<void> => {
    if (closing) throw new Error("OAuth state store is closed");
    if (client.isReady) return;
    connecting ??= connectAndPing().finally(() => {
      connecting = undefined;
    });
    await connecting;
  };

  const transactionReady = async (): Promise<void> => {
    if (closing) throw new Error("OAuth state store is closed");
    if (transactionClient.isReady) return;
    transactionConnecting ??= (async () => {
      if (!transactionClient.isOpen) await transactionClient.connect();
      const result = await transactionClient.ping();
      if (result !== "PONG") throw new Error("Redis readiness check failed");
    })().finally(() => {
      transactionConnecting = undefined;
    });
    await transactionConnecting;
  };

  const runTransaction = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = transactionTail.then(operation, operation);
    transactionTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const write = async (
    fullKey: string,
    encoded: string,
    ttlMs: number | undefined,
    transaction: RedisStringWriter = client
  ) => {
    if (ttlMs === undefined || !Number.isFinite(ttlMs)) {
      await transaction.set(fullKey, encoded);
    } else {
      await transaction.set(fullKey, encoded, {
        PX: Math.max(1, Math.ceil(ttlMs)),
      });
    }
  };

  const store: OAuthProxyStateStore = {
    async get<T>(key: string): Promise<T | undefined> {
      await ready();
      const raw = await client.get(keyPrefix + key);
      if (raw === null) return undefined;
      return (await decrypt(raw, keys)) as T;
    },
    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      await ready();
      await write(keyPrefix + key, await encrypt(value, keys[0]), ttlMs);
    },
    async setIfNewer<T>(
      key: string,
      value: T,
      ttlMs?: number
    ): Promise<boolean> {
      return runTransaction(async () => {
        const fullKey = keyPrefix + key;
        const encoded = await encrypt(value, keys[0]);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await transactionReady();
          await transactionClient.watch(fullKey);
          try {
            const raw = await transactionClient.get(fullKey);
            if (raw !== null) {
              const current = await decrypt(raw, keys);
              if (compareStateVersion(current, value) >= 0) {
                await transactionClient.unwatch();
                return false;
              }
            }
            const transaction = transactionClient.multi();
            await write(
              fullKey,
              encoded,
              ttlMs,
              transaction as unknown as RedisStringWriter
            );
            try {
              const result = await transaction.exec();
              if (result !== null) return true;
            } catch (error) {
              // node-redis rejects EXEC when another replica changed a
              // watched key. Treat that as an optimistic retry, not a store
              // outage; unrelated command errors still propagate.
              if (!isRedisWatchConflict(error)) throw error;
            }
          } finally {
            // `exec()` already clears WATCH; this is harmless for a conflict or
            // an exception and prevents a watch leaking into a later operation.
            await transactionClient.unwatch().catch(() => undefined);
          }
        }
        throw new Error("Redis state update conflicted repeatedly");
      });
    },
    async delete(key: string): Promise<void> {
      await ready();
      await client.del(keyPrefix + key);
    },
    async ready(): Promise<void> {
      await ready();
    },
    async close(): Promise<void> {
      closing = true;
      const pending = connecting;
      if (pending) {
        await Promise.race([
          pending.catch(() => undefined),
          timeout(shutdownTimeoutMs),
        ]);
      }
      const pendingTransaction = transactionConnecting;
      if (pendingTransaction) {
        await Promise.race([
          pendingTransaction.catch(() => undefined),
          timeout(shutdownTimeoutMs),
        ]);
      }
      await Promise.race([transactionTail, timeout(shutdownTimeoutMs)]);
      await Promise.all([
        closeRedisClient(client, shutdownTimeoutMs),
        closeRedisClient(transactionClient, shutdownTimeoutMs),
      ]);
    },
  };
  return store;
}

type RedisStringWriter = {
  set(key: string, value: string, options?: { PX: number }): Promise<unknown>;
};

async function closeRedisClient(
  client: {
    isOpen: boolean;
    quit(): Promise<unknown>;
    destroy(): unknown;
  },
  timeoutMs: number
): Promise<void> {
  if (!client.isOpen) return;
  await Promise.race([
    client.quit().catch(() => undefined),
    timeout(timeoutMs).then(() => {
      client.destroy();
    }),
  ]);
}

export function decodeOAuthProxyEncryptionKey(value: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new TypeError("OAuth proxy encryption key must be base64");
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = Uint8Array.from(Buffer.from(padded, "base64"));
  if (decoded.byteLength !== 32) {
    throw new TypeError("OAuth proxy encryption key must decode to 32 bytes");
  }
  return decoded;
}

function normalizeEncryptionKeys(options: {
  id: string | undefined;
  key: Uint8Array;
  previous: readonly OAuthProxyEncryptionKey[] | undefined;
}): OAuthProxyEncryptionKey[] {
  const primary = {
    id: options.id?.trim() || "current",
    key: options.key,
  } satisfies OAuthProxyEncryptionKey;
  const all = [primary, ...(options.previous ?? [])];
  const seen = new Set<string>();
  for (const entry of all) {
    if (!entry.id || seen.has(entry.id) || entry.key.byteLength !== 32) {
      throw new TypeError(
        "OAuth proxy encryption keys must have unique IDs and 32-byte keys"
      );
    }
    seen.add(entry.id);
  }
  return all.map((entry) => ({
    id: entry.id,
    key: Uint8Array.from(entry.key),
  }));
}

async function encrypt(
  value: unknown,
  key: OAuthProxyEncryptionKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cryptoKey = await importKey(key.key, "encrypt");
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintext)
  );
  return JSON.stringify({
    v: 1,
    kid: key.id,
    iv: Buffer.from(iv).toString("base64url"),
    ciphertext: Buffer.from(ciphertext).toString("base64url"),
  });
}

async function decrypt(
  value: string,
  keys: readonly OAuthProxyEncryptionKey[]
): Promise<unknown> {
  try {
    const envelope = JSON.parse(value) as {
      v?: unknown;
      kid?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
    };
    if (
      envelope.v !== 1 ||
      typeof envelope.iv !== "string" ||
      typeof envelope.ciphertext !== "string"
    ) {
      throw new Error("Invalid OAuth proxy state envelope");
    }
    const candidates =
      typeof envelope.kid === "string"
        ? keys.filter((key) => key.id === envelope.kid)
        : keys;
    if (candidates.length === 0) throw new Error("Unknown OAuth state key");
    for (const key of candidates) {
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: Buffer.from(envelope.iv, "base64url") },
          await importKey(key.key, "decrypt"),
          Buffer.from(envelope.ciphertext, "base64url")
        );
        return JSON.parse(new TextDecoder().decode(plaintext));
      } catch {
        // A rotated key is expected to fail until the matching key is tried.
      }
    }
  } catch {
    // Never include ciphertext, keys, or Redis values in the error.
  }
  throw new Error("Unable to decrypt OAuth proxy state");
}

async function importKey(
  key: Uint8Array,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  const copy = new ArrayBuffer(key.byteLength);
  new Uint8Array(copy).set(key);
  return crypto.subtle.importKey(
    "raw",
    copy,
    { name: "AES-GCM", length: 256 },
    false,
    [usage]
  );
}

function compareStateVersion(a: unknown, b: unknown): number {
  const av = stateVersion(a);
  const bv = stateVersion(b);
  if (av.revision !== bv.revision) return av.revision - bv.revision;
  return av.updatedAt - bv.updatedAt;
}

function stateVersion(value: unknown): { revision: number; updatedAt: number } {
  if (!value || typeof value !== "object") return { revision: 0, updatedAt: 0 };
  const record = value as Record<string, unknown>;
  return {
    revision:
      typeof record.revision === "number" && Number.isFinite(record.revision)
        ? record.revision
        : 0,
    updatedAt:
      typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : 0,
  };
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRedisWatchConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "WatchError" ||
      /watched keys? has been changed/i.test(error.message))
  );
}
