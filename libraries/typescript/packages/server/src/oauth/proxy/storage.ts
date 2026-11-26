import {
  decryptValue,
  encryptValue,
  sha256,
  type ProxyKeyring,
} from "./crypto.js";
import { printable } from "./upstream.js";

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
 * Adapters for Upstash, Redis, Postgres, Firestore, and Cloudflare are in
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
 * `oauthProxy` accepts it only when the MCP resource is on localhost and a
 * `listen()` binds a loopback address. A local `listen()` uses it by default
 * when no `storage` is set.
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
 *
 * Keys are namespaced by the MCP resource, so servers that share one store
 * and one secret never read or overwrite each other's records. The full key
 * is also the encryption's associated data, so a record copied to another
 * server's key does not decrypt.
 */
export class SecureStore {
  readonly #storage: OAuthProxyStorage;
  readonly #keyring: () => Promise<ProxyKeyring>;
  /** `mcp-use:oauth:<hash of the resource>:`, prepended to every key. */
  readonly #prefix: Promise<string>;
  /** Kinds of failure already logged, so stale records log once. */
  readonly #warned = new Set<string>();

  /**
   * @param storage - The application's store.
   * @param keyring - Loads the proxy keyring (derived once, on first use).
   * @param resource - Canonical URL of the MCP resource whose records this
   * store holds. A hash of it namespaces every key.
   */
  constructor(
    storage: OAuthProxyStorage,
    keyring: () => Promise<ProxyKeyring>,
    resource: URL
  ) {
    this.#storage = storage;
    this.#keyring = keyring;
    this.#prefix = sha256(resource.href).then(
      (hash) => `${KEY_PREFIX}${hash.slice(0, 16)}:`
    );
  }

  /** Reads and decrypts a record. */
  async get<T>(key: string): Promise<T | undefined> {
    const fullKey = (await this.#prefix) + key;
    return this.#decode<T>(key, fullKey, await this.#storage.get(fullKey));
  }

  /** Encrypts and writes a record. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const fullKey = (await this.#prefix) + key;
    await this.#storage.set(
      fullKey,
      await this.#encode(fullKey, value),
      ttl(ttlSeconds)
    );
  }

  /** Removes a record. */
  async delete(key: string): Promise<void> {
    await this.#storage.delete((await this.#prefix) + key);
  }

  /** Atomically reads, removes, and decrypts a record. */
  async take<T>(key: string): Promise<T | undefined> {
    const fullKey = (await this.#prefix) + key;
    return this.#decode<T>(key, fullKey, await this.#storage.take(fullKey));
  }

  /** Writes a record only when the key is absent. */
  async add(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const fullKey = (await this.#prefix) + key;
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
    key: string,
    fullKey: string,
    stored: string | undefined
  ): Promise<T | undefined> {
    if (typeof stored !== "string") return undefined;
    const keyring = await this.#keyring();
    const plaintext = await decryptValue(keyring, fullKey, stored);
    if (plaintext === undefined) {
      this.#warnUnreadable(keyring, key, stored);
      return undefined;
    }
    try {
      return JSON.parse(plaintext) as T;
    } catch {
      return undefined;
    }
  }

  /**
   * Logs a record that does not decrypt, which otherwise reads as expired.
   * Logs only the kind of record and the key id, once per kind.
   */
  #warnUnreadable(keyring: ProxyKeyring, key: string, stored: string) {
    const kid = printable(stored.split(".")[1] ?? "", 32);
    const known = keyring.all.some((entry) => entry.kid === kid);
    const kind = key.split(":")[0] ?? "";
    const id = known ? `record:${kind}` : `kid:${kid}`;
    if (this.#warned.has(id)) return;
    this.#warned.add(id);
    console.warn(
      known
        ? `[mcp-use] oauthProxy: a stored "${kind}" record failed to decrypt and reads as absent. Is something else writing to the same keys?`
        : `[mcp-use] oauthProxy: stored records were encrypted with a secret this server does not have (key id "${kid}"), so they read as absent and those users must sign in again. If the secret changed, pass the old one after the new one to keep their sign-ins: secret: [newSecret, oldSecret].`
    );
  }
}

function ttl(seconds: number): number {
  return Math.max(1, Math.ceil(seconds));
}
