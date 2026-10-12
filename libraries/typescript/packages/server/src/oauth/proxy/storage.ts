import { decryptValue, encryptValue, type ProxyKeyring } from "./crypto.js";

/**
 * Key-value store that holds the OAuth proxy's state between requests:
 * registered clients, sign-in transactions, one-time codes, grants, tokens,
 * and the upstream tokens of each user.
 *
 * The proxy encrypts every value with a key derived from its `secret` before
 * the store sees it, and stores only hashes of tokens in keys. A store
 * therefore never holds a usable token, but it must be shared by every
 * instance of the server and must implement `take` and `add` atomically.
 *
 * Adapters for Upstash, Redis, Postgres, and Cloudflare are in
 * `mcp-use/oauth/storage`.
 */
export interface OAuthProxyStorage {
  /**
   * Reads a value.
   *
   * @param key - Storage key.
   * @returns The value, or `undefined` when it is absent or expired.
   */
  get(key: string): Promise<string | undefined>;
  /**
   * Writes a value, replacing any current value.
   *
   * @param key - Storage key.
   * @param value - Value to store.
   * @param ttlSeconds - Seconds until the value expires. Always a positive integer.
   */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /**
   * Removes a value. Removing an absent key is not an error.
   *
   * @param key - Storage key.
   */
  delete(key: string): Promise<void>;
  /**
   * Reads and removes a value in one atomic step, so that two concurrent
   * calls never both get it (Redis `GETDEL`, SQL `DELETE … RETURNING`).
   * One-time codes and sign-in states depend on this.
   *
   * @param key - Storage key.
   * @returns The value, or `undefined` when it is absent or expired.
   */
  take(key: string): Promise<string | undefined>;
  /**
   * Writes a value only when the key is absent, in one atomic step (Redis
   * `SET NX`, SQL `INSERT … ON CONFLICT DO NOTHING`). Locks depend on this.
   *
   * @param key - Storage key.
   * @param value - Value to store.
   * @param ttlSeconds - Seconds until the value expires. Always a positive integer.
   * @returns `true` when the value was written, `false` when the key exists.
   */
  add(key: string, value: string, ttlSeconds: number): Promise<boolean>;
}

const MEMORY_STORAGE = Symbol.for("mcp-use.oauth.memoryStorage");

/**
 * Creates an in-process store for local development.
 *
 * Its state is lost on restart and is not shared between instances, so
 * `oauthProxy` accepts it only when the MCP resource is on localhost. A
 * local `listen()` uses it by default when no `storage` is set.
 *
 * @returns A store that keeps values in memory.
 */
export function memoryStorage(): OAuthProxyStorage {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const read = (key: string): string | undefined => {
    const entry = values.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      values.delete(key);
      return undefined;
    }
    return entry.value;
  };
  const write = (key: string, value: string, ttlSeconds: number): void => {
    if (values.size > 10_000) {
      for (const [candidate, entry] of values) {
        if (entry.expiresAt <= Date.now()) values.delete(candidate);
      }
    }
    values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  };
  const storage: OAuthProxyStorage = {
    get: async (key) => read(key),
    set: async (key, value, ttlSeconds) => write(key, value, ttlSeconds),
    delete: async (key) => {
      values.delete(key);
    },
    take: async (key) => {
      const value = read(key);
      values.delete(key);
      return value;
    },
    add: async (key, value, ttlSeconds) => {
      if (read(key) !== undefined) return false;
      write(key, value, ttlSeconds);
      return true;
    },
  };
  Object.defineProperty(storage, MEMORY_STORAGE, { value: true });
  return storage;
}

/** @internal Whether a store came from {@link memoryStorage}. */
export function isMemoryStorage(storage: OAuthProxyStorage): boolean {
  return (
    (storage as unknown as Record<symbol, unknown>)[MEMORY_STORAGE] === true
  );
}

/** @internal Checks that a value implements {@link OAuthProxyStorage}. */
export function assertStorage(
  storage: unknown
): asserts storage is OAuthProxyStorage {
  if (storage === null || typeof storage !== "object") {
    throw new TypeError("oauthProxy storage must be an object");
  }
  for (const method of ["get", "set", "delete", "take", "add"]) {
    if (typeof (storage as Record<string, unknown>)[method] !== "function") {
      throw new TypeError(`oauthProxy storage must implement ${method}()`);
    }
  }
}

const KEY_PREFIX = "mcp-use:oauth:";

/**
 * @internal JSON records over an {@link OAuthProxyStorage}, encrypted with
 * the proxy keyring. A value that fails to decrypt or parse reads as absent.
 */
export class SecureStore {
  readonly #storage: OAuthProxyStorage;
  readonly #keyring: () => Promise<ProxyKeyring>;

  /**
   * @param storage - The application's store.
   * @param keyring - Loads the proxy keyring (derived once, on first use).
   */
  constructor(
    storage: OAuthProxyStorage,
    keyring: () => Promise<ProxyKeyring>
  ) {
    this.#storage = storage;
    this.#keyring = keyring;
  }

  /** Reads and decrypts a record. */
  async get<T>(key: string): Promise<T | undefined> {
    const fullKey = KEY_PREFIX + key;
    return this.#decode<T>(fullKey, await this.#storage.get(fullKey));
  }

  /** Encrypts and writes a record. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const fullKey = KEY_PREFIX + key;
    await this.#storage.set(
      fullKey,
      await this.#encode(fullKey, value),
      ttl(ttlSeconds)
    );
  }

  /** Removes a record. */
  async delete(key: string): Promise<void> {
    await this.#storage.delete(KEY_PREFIX + key);
  }

  /** Atomically reads, removes, and decrypts a record. */
  async take<T>(key: string): Promise<T | undefined> {
    const fullKey = KEY_PREFIX + key;
    return this.#decode<T>(fullKey, await this.#storage.take(fullKey));
  }

  /** Writes a record only when the key is absent. */
  async add(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const fullKey = KEY_PREFIX + key;
    return this.#storage.add(
      fullKey,
      await this.#encode(fullKey, value),
      ttl(ttlSeconds)
    );
  }

  async #encode(fullKey: string, value: unknown): Promise<string> {
    return encryptValue(await this.#keyring(), fullKey, JSON.stringify(value));
  }

  async #decode<T>(
    fullKey: string,
    stored: string | undefined
  ): Promise<T | undefined> {
    if (typeof stored !== "string") return undefined;
    const plaintext = await decryptValue(
      await this.#keyring(),
      fullKey,
      stored
    );
    if (plaintext === undefined) return undefined;
    try {
      return JSON.parse(plaintext) as T;
    } catch {
      return undefined;
    }
  }
}

function ttl(seconds: number): number {
  return Math.max(1, Math.ceil(seconds));
}
