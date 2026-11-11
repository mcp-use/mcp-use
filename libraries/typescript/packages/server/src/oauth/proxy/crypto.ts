/**
 * Key derivation, value encryption, and token helpers for the OAuth proxy.
 * Web Crypto only, so the proxy runs on Node, Deno, Bun, and Workers.
 *
 * @internal
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 32;

/** @internal Keys derived from one configured secret. */
export interface ProxyKey {
  /** Stable, non-secret identifier written next to each ciphertext. */
  readonly kid: string;
  /** AES-256-GCM key for stored values. */
  readonly storage: CryptoKey;
  /** HMAC secret for signed cookies (hono/cookie takes bytes). */
  readonly cookie: Uint8Array<ArrayBuffer>;
}

/** @internal The current key first, then previous keys that only decrypt. */
export interface ProxyKeyring {
  /** Key for new ciphertexts and new cookies. */
  readonly current: ProxyKey;
  /** Every key, current first, for decryption and cookie checks. */
  readonly all: readonly ProxyKey[];
}

/** @internal Validates the configured secret(s) without deriving keys. */
export function normalizeSecrets(secret: unknown): string[] {
  const secrets = Array.isArray(secret) ? secret : [secret];
  if (secrets.length === 0) {
    throw new TypeError("oauthProxy secret must not be an empty array");
  }
  for (const value of secrets) {
    if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) {
      throw new TypeError(
        `oauthProxy secret must be a string of at least ${MIN_SECRET_LENGTH} characters`
      );
    }
  }
  return secrets as string[];
}

/** @internal Derives the keyring from the secrets, current secret first. */
export async function deriveKeyring(
  secrets: readonly string[]
): Promise<ProxyKeyring> {
  const all = await Promise.all(secrets.map((secret) => deriveKey(secret)));
  return { current: all[0]!, all };
}

/** @internal Creates a keyring from fresh random bytes, for local development. */
export async function randomKeyring(): Promise<ProxyKeyring> {
  return deriveKeyring([randomToken(32)]);
}

async function deriveKey(secret: string): Promise<ProxyKey> {
  const ikm = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey", "deriveBits"]
  );
  const hkdf = (info: string): HkdfParams => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: textEncoder.encode(`mcp-use/oauth-proxy/${info}`),
  });
  const [storage, cookieBits, kidBits] = await Promise.all([
    crypto.subtle.deriveKey(
      hkdf("storage"),
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    ),
    crypto.subtle.deriveBits(hkdf("cookie"), ikm, 256),
    crypto.subtle.deriveBits(hkdf("kid"), ikm, 64),
  ]);
  return {
    kid: toHex(new Uint8Array(kidBits)),
    storage,
    cookie: new Uint8Array(cookieBits),
  };
}

/**
 * @internal Encrypts a value with the current key. The storage key is the
 * authenticated data, so a ciphertext copied to another key fails to decrypt.
 */
export async function encryptValue(
  keyring: ProxyKeyring,
  storageKey: string,
  plaintext: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: textEncoder.encode(storageKey),
      tagLength: 128,
    },
    keyring.current.storage,
    textEncoder.encode(plaintext)
  );
  return [
    ENVELOPE_VERSION,
    keyring.current.kid,
    base64UrlEncode(iv),
    base64UrlEncode(new Uint8Array(ciphertext)),
  ].join(".");
}

/**
 * @internal Decrypts a value written by any key in the keyring. Returns
 * `undefined` for an unknown key, a tampered value, or a value moved from
 * another storage key.
 */
export async function decryptValue(
  keyring: ProxyKeyring,
  storageKey: string,
  envelope: string
): Promise<string | undefined> {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) return undefined;
  const key = keyring.all.find((candidate) => candidate.kid === parts[1]);
  if (key === undefined) return undefined;
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlDecode(parts[2]!),
        additionalData: textEncoder.encode(storageKey),
        tagLength: 128,
      },
      key.storage,
      base64UrlDecode(parts[3]!)
    );
    return textDecoder.decode(plaintext);
  } catch {
    return undefined;
  }
}

/** @internal Random URL-safe token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** @internal SHA-256 of a UTF-8 string, base64url without padding. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

/** @internal RFC 7636 S256 code challenge for a verifier. */
export function pkceChallenge(verifier: string): Promise<string> {
  return sha256(verifier);
}

/** @internal Compares two strings in time that depends only on their length. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = textEncoder.encode(a);
  const right = textEncoder.encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** @internal Base64url encoding without padding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new TypeError("Invalid base64url value");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}
