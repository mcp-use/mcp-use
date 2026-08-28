import { createClient } from "redis";

/**
 * Durable state boundary used by the hosted OAuth BFF.
 *
 * Implementations must apply the supplied TTL and must not log values. The
 * proxy stores only metadata bindings and confidential-client credentials at
 * this boundary; browser-visible OAuth responses are always sanitized before
 * they leave the proxy.
 */
export interface OAuthProxyStateStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  close?(): Promise<void>;
}

/** Process-local fallback for local development and unit tests. */
export function createMemoryOAuthProxyStateStore(): OAuthProxyStateStore {
  const values = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = values.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        values.delete(key);
        return undefined;
      }
      return structuredClone(entry.value) as T;
    },
    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
      values.set(key, {
        value: structuredClone(value),
        expiresAt: Date.now() + Math.max(1, ttlMs),
      });
    },
    async delete(key: string): Promise<void> {
      values.delete(key);
    },
  };
}

/**
 * Redis-backed store for Railway/production deployments.
 *
 * Values are encrypted with AES-256-GCM before persistence. The encryption key
 * is supplied by the deployment secret manager and never returned to callers.
 */
export function createRedisOAuthProxyStateStore(options: {
  url: string;
  encryptionKey: Uint8Array;
  keyPrefix?: string;
}): OAuthProxyStateStore {
  if (!options.url) throw new TypeError("Redis URL is required");
  if (options.encryptionKey.byteLength !== 32) {
    throw new TypeError("OAuth proxy encryption key must be 32 bytes");
  }

  const client = createClient({ url: options.url });
  // Redis requires an error listener; keep diagnostics out of logs because
  // connection URLs can contain credentials.
  client.on("error", () => undefined);
  const keyPrefix = options.keyPrefix ?? "mcp-use:inspector:oauth:";
  let connecting: Promise<void> | undefined;
  const ready = async () => {
    if (!client.isReady) {
      connecting ??= client.connect().then(() => undefined);
      await connecting;
    }
    return client;
  };

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = await (await ready()).get(keyPrefix + key);
      if (raw === null) return undefined;
      return (await decrypt(raw, options.encryptionKey)) as T;
    },
    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
      const encoded = await encrypt(value, options.encryptionKey);
      await (await ready()).set(keyPrefix + key, encoded, {
        PX: Math.max(1, Math.ceil(ttlMs)),
      });
    },
    async delete(key: string): Promise<void> {
      await (await ready()).del(keyPrefix + key);
    },
    async close(): Promise<void> {
      if (client.isOpen) await client.quit();
    },
  };
}

export function decodeOAuthProxyEncryptionKey(value: string): Uint8Array {
  const normalized = value.trim();
  let decoded: Uint8Array;
  try {
    decoded = Uint8Array.from(Buffer.from(normalized, "base64"));
  } catch {
    throw new TypeError("OAuth proxy encryption key must be base64");
  }
  if (decoded.byteLength !== 32) {
    throw new TypeError("OAuth proxy encryption key must decode to 32 bytes");
  }
  return decoded;
}

async function encrypt(value: unknown, key: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintext)
  );
  return JSON.stringify({
    v: 1,
    iv: Buffer.from(iv).toString("base64url"),
    ciphertext: Buffer.from(ciphertext).toString("base64url"),
  });
}

async function decrypt(value: string, key: Uint8Array): Promise<unknown> {
  try {
    const envelope = JSON.parse(value) as {
      v?: unknown;
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
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(key),
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(envelope.iv, "base64url") },
      cryptoKey,
      Buffer.from(envelope.ciphertext, "base64url")
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Unable to decrypt OAuth proxy state");
  }
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return copy;
}
