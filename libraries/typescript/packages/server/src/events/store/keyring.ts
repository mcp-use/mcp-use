/**
 * Events keyring (PLAN.md §8.5, D22): a list of secrets, the first seals and
 * all open. Keys are HKDF-derived under the domain `mcp-use/events/v1`, so
 * they never equal the OAuth proxy's (`mcp-use/oauth-proxy/`).
 *
 * @internal
 */

/**
 * UTF-8 encodes text.
 *
 * @param text - The text.
 * @returns Its bytes.
 */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
}

/**
 * Unpadded base64url.
 *
 * @param bytes - The bytes.
 * @returns The encoding.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes base64url (padded or not).
 *
 * @param text - The encoding.
 * @returns The bytes, or `undefined` when malformed.
 */
export function fromBase64Url(
  text: string
): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*=*$/.test(text)) return undefined;
  try {
    const bin = atob(
      text.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")
    );
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

/**
 * SHA-256.
 *
 * @param bytes - Input.
 * @returns The digest.
 */
export async function sha256(
  bytes: Uint8Array<ArrayBuffer>
): Promise<Uint8Array> {
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes)
  );
}

/** HKDF info domain of every Events key. */
export const EVENTS_HKDF_DOMAIN = "mcp-use/events/v1";

/** One derived key. */
export interface EventsKey {
  /** 16-hex-char key id written into every sealed value. */
  readonly kid: string;
  /** AES-256-GCM key. */
  readonly aes: CryptoKey;
}

/** A keyring: `current` seals, `all` (current first) open. */
export interface EventsKeyring {
  readonly current: EventsKey;
  readonly all: readonly EventsKey[];
}

async function derive(secret: string): Promise<EventsKey> {
  const subtle = globalThis.crypto.subtle;
  const ikm = await subtle.importKey("raw", utf8(secret), "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
  const params = (info: string): HkdfParams => ({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: utf8(`${EVENTS_HKDF_DOMAIN}/${info}`),
  });
  const [aes, kidBits] = await Promise.all([
    subtle.deriveKey(
      params("seal"),
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    ),
    subtle.deriveBits(params("kid"), ikm, 64),
  ]);
  const kid = Array.from(new Uint8Array(kidBits), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  return { kid, aes };
}

/**
 * Derives a keyring from one secret or a rotation list.
 *
 * @param secrets - The secret, or a list whose first entry is current.
 * @returns The keyring.
 * @throws TypeError when no non-empty secret is given.
 */
export async function createEventsKeyring(
  secrets: string | readonly string[]
): Promise<EventsKeyring> {
  const list = (typeof secrets === "string" ? [secrets] : [...secrets]).filter(
    (s) => s.length > 0
  );
  if (list.length === 0) {
    throw new TypeError("Events keyring needs at least one non-empty secret");
  }
  const all = await Promise.all(list.map(derive));
  return { current: all[0]!, all };
}

/**
 * A short public fingerprint of the current key (startup line, admin status).
 *
 * @param keyring - The keyring.
 * @returns The first 8 characters of the current kid, base64url of its bytes.
 */
export function keyringFingerprint(keyring: EventsKeyring): string {
  return toBase64Url(utf8(keyring.current.kid)).slice(0, 8);
}
