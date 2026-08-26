const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = "A256GCM";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AAD_SCHEMA = "mcp-use/oauth-proxy/byte-payload/v1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** @internal One named, raw AES-256 key in an OAuth proxy encryption keyring. */
export interface OAuthProxyEncryptionKey {
  /** Non-empty identifier serialized with ciphertext for later key rotation. */
  readonly id: string;
  /** Exactly 32 bytes of raw key material; passphrases are not accepted. */
  readonly key: Uint8Array;
}

/** @internal SDK-managed encryption configuration for persisted proxy payloads. */
export interface OAuthProxyEncryptionOptions {
  /** Key identifier used for new writes. */
  readonly primaryKeyId: string;
  /** Keyring used to encrypt new values and decrypt values written by old keys. */
  readonly keys: readonly OAuthProxyEncryptionKey[];
  /** Web Crypto implementation, primarily for isolated runtimes and tests. */
  readonly crypto?: Pick<Crypto, "getRandomValues" | "subtle">;
}

/** @internal Byte-oriented persistence codec, independent of OAuth record schemas. */
export interface OAuthProxyPayloadCodec {
  /** Encodes a payload, binding it to its stable store key as authenticated data. */
  encode(storeKey: string, payload: Uint8Array): Promise<Uint8Array>;
  /** Decodes a payload and fails closed if its envelope or authentication is invalid. */
  decode(storeKey: string, serialized: Uint8Array): Promise<Uint8Array>;
}

interface EncryptionEnvelope {
  readonly v: typeof ENVELOPE_VERSION;
  readonly alg: typeof ENVELOPE_ALGORITHM;
  readonly kid: string;
  readonly iv: string;
  readonly ciphertext: string;
}

/** @internal Creates a versioned AES-256-GCM codec from a validated raw-key keyring. */
export function createOAuthProxyEncryptionCodec(
  options: OAuthProxyEncryptionOptions
): OAuthProxyPayloadCodec {
  const validated = validateOptions(options);
  const importedKeys = new Map<string, Promise<CryptoKey>>();

  const importKey = (id: string): Promise<CryptoKey> => {
    let imported = importedKeys.get(id);
    if (imported !== undefined) {
      return imported;
    }
    const raw = validated.keys.get(id);
    if (raw === undefined) {
      return Promise.reject(new Error("Unknown OAuth proxy encryption key"));
    }
    imported = validated.crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    importedKeys.set(id, imported);
    return imported;
  };

  return {
    async encode(storeKey, payload) {
      assertStoreKey(storeKey);
      assertBytes(payload, "payload");
      const iv = new Uint8Array(IV_BYTES);
      validated.crypto.getRandomValues(iv);
      const ciphertext = await validated.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: additionalData(storeKey),
          tagLength: 128,
        },
        await importKey(validated.primaryKeyId),
        copyToArrayBuffer(payload)
      );
      const envelope: EncryptionEnvelope = {
        v: ENVELOPE_VERSION,
        alg: ENVELOPE_ALGORITHM,
        kid: validated.primaryKeyId,
        iv: encodeBase64Url(iv),
        ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
      };
      return textEncoder.encode(JSON.stringify(envelope));
    },

    async decode(storeKey, serialized) {
      assertStoreKey(storeKey);
      assertBytes(serialized, "serialized payload");
      try {
        const envelope = parseEnvelope(serialized);
        const key = await importKey(envelope.kid);
        const plaintext = await validated.crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decodeBase64Url(envelope.iv),
            additionalData: additionalData(storeKey),
            tagLength: 128,
          },
          key,
          decodeBase64Url(envelope.ciphertext)
        );
        return new Uint8Array(plaintext);
      } catch {
        throw new Error("Unable to decrypt OAuth proxy payload");
      }
    },
  };
}

/** @internal Pass-through byte codec used only where plaintext storage is safe. */
export function createOAuthProxyPlaintextCodec(): OAuthProxyPayloadCodec {
  return {
    async encode(storeKey, payload) {
      assertStoreKey(storeKey);
      assertBytes(payload, "payload");
      return Uint8Array.from(payload);
    },
    async decode(storeKey, serialized) {
      assertStoreKey(storeKey);
      assertBytes(serialized, "serialized payload");
      return Uint8Array.from(serialized);
    },
  };
}

function validateOptions(options: OAuthProxyEncryptionOptions): {
  readonly primaryKeyId: string;
  readonly keys: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  readonly crypto: Pick<Crypto, "getRandomValues" | "subtle">;
} {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("OAuth proxy encryption options must be an object");
  }
  const primaryKeyId = requireKeyId(options.primaryKeyId, "primaryKeyId");
  if (!Array.isArray(options.keys) || options.keys.length === 0) {
    throw new TypeError(
      "OAuth proxy encryption keys must be a non-empty array"
    );
  }
  const keys = new Map<string, Uint8Array<ArrayBuffer>>();
  const candidates: readonly unknown[] = options.keys;
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) {
      throw new TypeError("Each OAuth proxy encryption key must be an object");
    }
    const record = candidate as Record<string, unknown>;
    const id = requireKeyId(record.id, "encryption key id");
    if (keys.has(id)) {
      throw new TypeError(`Duplicate OAuth proxy encryption key id: ${id}`);
    }
    assertBytes(record.key, `encryption key ${id}`);
    if (record.key.byteLength !== KEY_BYTES) {
      throw new TypeError(`OAuth proxy encryption key ${id} must be 32 bytes`);
    }
    keys.set(id, new Uint8Array(copyToArrayBuffer(record.key)));
  }
  if (!keys.has(primaryKeyId)) {
    throw new TypeError(
      "OAuth proxy encryption primaryKeyId is not in the keyring"
    );
  }
  const cryptoImplementation = options.crypto ?? globalThis.crypto;
  if (
    typeof cryptoImplementation !== "object" ||
    cryptoImplementation === null ||
    typeof cryptoImplementation.getRandomValues !== "function" ||
    typeof cryptoImplementation.subtle !== "object" ||
    cryptoImplementation.subtle === null
  ) {
    throw new TypeError("OAuth proxy encryption requires Web Crypto");
  }
  return { primaryKeyId, keys, crypto: cryptoImplementation };
}

function parseEnvelope(serialized: Uint8Array): EncryptionEnvelope {
  const value: unknown = JSON.parse(textDecoder.decode(serialized));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Malformed OAuth proxy encryption envelope");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 5 ||
    record.v !== ENVELOPE_VERSION ||
    record.alg !== ENVELOPE_ALGORITHM ||
    typeof record.kid !== "string" ||
    record.kid.length === 0 ||
    typeof record.iv !== "string" ||
    typeof record.ciphertext !== "string"
  ) {
    throw new Error("Malformed OAuth proxy encryption envelope");
  }
  const iv = decodeBase64Url(record.iv);
  const ciphertext = decodeBase64Url(record.ciphertext);
  if (iv.byteLength !== IV_BYTES || ciphertext.byteLength < 16) {
    throw new Error("Malformed OAuth proxy encryption envelope");
  }
  return {
    v: ENVELOPE_VERSION,
    alg: ENVELOPE_ALGORITHM,
    kid: record.kid,
    iv: record.iv,
    ciphertext: record.ciphertext,
  };
}

function additionalData(storeKey: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    copyToArrayBuffer(textEncoder.encode(`${AAD_SCHEMA}\0${storeKey}`))
  );
}

function requireKeyId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertStoreKey(storeKey: string): void {
  if (typeof storeKey !== "string" || storeKey.length === 0) {
    throw new TypeError("OAuth proxy store key must be a non-empty string");
  }
}

function assertBytes(
  value: unknown,
  label: string
): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid base64url value");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") + padding
  );
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  if (encodeBase64Url(result) !== value) {
    throw new Error("Non-canonical base64url value");
  }
  return result;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}
