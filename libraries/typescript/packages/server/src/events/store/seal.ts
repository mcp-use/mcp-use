/**
 * AES-GCM sealing of every record, job, log value and dead letter
 * (PLAN.md §8.5, D22). The full storage key is the associated data, so a
 * value copied to another key never opens. Envelope:
 * `s1.<kid>.<iv b64url>.<ciphertext+tag b64url>`.
 *
 * @internal
 */

import {
  fromBase64Url,
  toBase64Url,
  utf8,
  type EventsKeyring,
} from "./keyring.js";

const ENVELOPE = "s1";
const IV_BYTES = 12;

/** Seals and opens values bound to their storage key. */
export interface Sealer {
  /** `false` for the dev runtime's plaintext sealer. */
  readonly sealed: boolean;
  seal(key: string, plaintext: string): Promise<string>;
  /** `undefined` for an unknown key id, tampering or a value moved from another key. */
  open(key: string, value: string): Promise<string | undefined>;
}

/**
 * Seals with the keyring's current key.
 *
 * @param keyring - The keyring.
 * @param key - Full storage key (associated data).
 * @param plaintext - The JSON text.
 * @returns The envelope string.
 */
export async function sealValue(
  keyring: EventsKeyring,
  key: string,
  plaintext: string
): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8(key), tagLength: 128 },
    keyring.current.aes,
    utf8(plaintext)
  );
  return [
    ENVELOPE,
    keyring.current.kid,
    toBase64Url(iv),
    toBase64Url(new Uint8Array(ct)),
  ].join(".");
}

/**
 * Opens a value sealed by any key of the keyring.
 *
 * @param keyring - The keyring.
 * @param key - Full storage key the value was read from.
 * @param value - The envelope.
 * @returns The plaintext, or `undefined`.
 */
export async function openValue(
  keyring: EventsKeyring,
  key: string,
  value: string
): Promise<string | undefined> {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE) return undefined;
  const k = keyring.all.find((c) => c.kid === parts[1]);
  const iv = fromBase64Url(parts[2]!);
  const ct = fromBase64Url(parts[3]!);
  if (!k || !iv || !ct) return undefined;
  try {
    const pt = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
        additionalData: utf8(key),
        tagLength: 128,
      },
      k.aes,
      ct
    );
    return new TextDecoder().decode(pt);
  } catch {
    return undefined;
  }
}

/**
 * The production sealer.
 *
 * @param keyring - The keyring.
 * @returns A sealer bound to it.
 */
export function createSealer(keyring: EventsKeyring): Sealer {
  return {
    sealed: true,
    seal: (key, pt) => sealValue(keyring, key, pt),
    open: (key, v) => openValue(keyring, key, v),
  };
}

/**
 * The dev runtime's sealer: values are stored as plaintext (D22).
 *
 * @returns A pass-through sealer.
 */
export function plaintextSealer(): Sealer {
  return {
    sealed: false,
    seal: async (_key, pt) => pt,
    open: async (_key, v) => v,
  };
}
