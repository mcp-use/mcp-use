/**
 * Minimal key/value storage abstraction used by OAuthSessionStore.
 *
 * Browser-safe module — Node filesystem KV lives in `storage-file.ts`.
 *
 * @internal
 */
export interface KVStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
  keys(): Promise<string[]> | string[];
}

type EncryptedEnvelope = {
  v: 1;
  alg: "A256GCM";
  iv: string;
  ciphertext: string;
};

const AUTH_CRYPTO_DATABASE = "mcp-use-oauth-crypto";
const AUTH_CRYPTO_STORE = "keys";
const AUTH_CRYPTO_KEY = "aes-gcm-v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encrypted `KVStore` backed by `globalThis.localStorage`.
 *
 * Values use AES-256-GCM with a non-extractable origin key held by IndexedDB.
 * Legacy plaintext values are encrypted on first read. When durable browser
 * cryptography is unavailable, the store removes plaintext and falls back to
 * memory for the lifetime of this instance.
 *
 * @internal
 */
export class LocalStorageKVStore implements KVStore {
  private readonly fallback = new Map<string, string>();
  private keyPromise: Promise<CryptoKey> | undefined;
  private durable = true;

  async get(key: string): Promise<string | null> {
    if (!this.durable) return this.fallback.get(key) ?? null;

    let stored: string | null;
    try {
      stored = localStorage.getItem(key);
    } catch {
      this.durable = false;
      return this.fallback.get(key) ?? null;
    }
    if (stored === null) return null;

    const envelope = parseEncryptedEnvelope(stored);
    if (!envelope) {
      await this.set(key, stored);
      return stored;
    }

    try {
      const cryptoKey = await this.getCryptoKey();
      const plaintext = await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decodeBase64(envelope.iv),
          additionalData: textEncoder.encode(key),
        },
        cryptoKey,
        decodeBase64(envelope.ciphertext)
      );
      return textDecoder.decode(plaintext);
    } catch {
      await this.remove(key);
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.durable) {
      this.fallback.set(key, value);
      return;
    }

    try {
      const cryptoKey = await this.getCryptoKey();
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: textEncoder.encode(key),
        },
        cryptoKey,
        textEncoder.encode(value)
      );
      const envelope: EncryptedEnvelope = {
        v: 1,
        alg: "A256GCM",
        iv: encodeBase64(iv),
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      };
      localStorage.setItem(key, JSON.stringify(envelope));
      this.fallback.delete(key);
    } catch {
      this.durable = false;
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage may be disabled entirely.
      }
      this.fallback.set(key, value);
    }
  }

  remove(key: string): void {
    this.fallback.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      this.durable = false;
    }
  }

  keys(): string[] {
    const out = new Set(this.fallback.keys());
    if (this.durable) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) out.add(key);
        }
      } catch {
        this.durable = false;
      }
    }
    return [...out];
  }

  private getCryptoKey(): Promise<CryptoKey> {
    this.keyPromise ??= getOrCreateCryptoKey();
    return this.keyPromise;
  }
}

function parseEncryptedEnvelope(value: string): EncryptedEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("v" in parsed) ||
      parsed.v !== 1 ||
      !("alg" in parsed) ||
      parsed.alg !== "A256GCM" ||
      !("iv" in parsed) ||
      typeof parsed.iv !== "string" ||
      !("ciphertext" in parsed) ||
      typeof parsed.ciphertext !== "string"
    ) {
      return undefined;
    }
    return parsed as EncryptedEnvelope;
  } catch {
    return undefined;
  }
}

async function getOrCreateCryptoKey(): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle || typeof indexedDB === "undefined") {
    throw new Error("Durable browser cryptography is unavailable");
  }

  const candidate = await globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const database = await openCryptoDatabase();
  try {
    return await new Promise<CryptoKey>((resolve, reject) => {
      const transaction = database.transaction(AUTH_CRYPTO_STORE, "readwrite");
      const store = transaction.objectStore(AUTH_CRYPTO_STORE);
      const request = store.get(AUTH_CRYPTO_KEY);
      let selected: CryptoKey | undefined;

      request.onsuccess = () => {
        selected = request.result as CryptoKey | undefined;
        if (!selected) {
          selected = candidate;
          store.put(candidate, AUTH_CRYPTO_KEY);
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {
        if (selected) resolve(selected);
        else reject(new Error("OAuth encryption key was not initialized"));
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function openCryptoDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTH_CRYPTO_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(AUTH_CRYPTO_STORE)) {
        database.createObjectStore(AUTH_CRYPTO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("OAuth encryption database is blocked"));
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
