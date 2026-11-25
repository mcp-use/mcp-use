/**
 * Standard Webhooks secrets: generation, strict validation for
 * `events/subscribe` (`events.mdx:445`) and lenient parsing for receivers.
 *
 * @packageDocumentation
 */

import { fromBase64, randomBytes, toBase64 } from "./encoding.js";

/** The prefix of every Standard Webhooks symmetric secret. */
export const WEBHOOK_SECRET_PREFIX = "whsec_";

/** The fewest secret bytes SEP-3415 accepts. */
export const MIN_WEBHOOK_SECRET_BYTES = 24;

/** The most secret bytes SEP-3415 accepts. */
export const MAX_WEBHOOK_SECRET_BYTES = 64;

/**
 * Generates a Standard Webhooks secret: `whsec_` + standard base64 (with
 * padding) of fresh CSPRNG bytes.
 *
 * @param bytes - Number of random bytes, 24 to 64; default 32.
 * @returns The secret.
 * @throws RangeError when `bytes` is not an integer from 24 to 64.
 */
export function generateWebhookSecret(bytes = 32): `whsec_${string}` {
  if (
    !Number.isInteger(bytes) ||
    bytes < MIN_WEBHOOK_SECRET_BYTES ||
    bytes > MAX_WEBHOOK_SECRET_BYTES
  ) {
    throw new RangeError(
      `A webhook secret needs ${MIN_WEBHOOK_SECRET_BYTES} to ${MAX_WEBHOOK_SECRET_BYTES} bytes`
    );
  }
  return `${WEBHOOK_SECRET_PREFIX}${toBase64(randomBytes(bytes))}`;
}

function decodeBase64Loose(
  text: string,
  urlSafe: boolean
): Uint8Array | undefined {
  const alphabet = urlSafe
    ? /^[A-Za-z0-9_-]*={0,2}$/
    : /^[A-Za-z0-9+/]*={0,2}$/;
  if (!alphabet.test(text)) return undefined;
  const body = text.replace(/=+$/, "");
  const padding = text.length - body.length;
  if (padding > 0 && text.length % 4 !== 0) return undefined;
  if (body.length % 4 === 1) return undefined;
  const standard = urlSafe ? body.replace(/-/g, "+").replace(/_/g, "/") : body;
  return fromBase64(standard + "=".repeat((4 - (standard.length % 4)) % 4));
}

/** The outcome of {@link validateWebhookSecret}. */
export type WebhookSecretCheck =
  | {
      /** The secret is acceptable. */
      ok: true;
      /** The decoded secret bytes. */
      bytes: Uint8Array;
    }
  | {
      /** The secret is not acceptable. */
      ok: false;
      /** Why: `prefix`, `encoding` or `length`. */
      reason: "prefix" | "encoding" | "length";
    };

/**
 * Validates `delivery.secret` of `events/subscribe` strictly: the literal
 * `whsec_` prefix, then standard base64 (RFC 4648 §4 alphabet; `=` padding
 * optional but correct when present) decoding to 24 to 64 bytes. URL-safe
 * characters are rejected. A failure is InvalidParams `{field:"delivery.secret"}`.
 *
 * @param secret - The value the client sent.
 * @returns The decoded bytes, or the reason for rejection.
 */
export function validateWebhookSecret(secret: string): WebhookSecretCheck {
  if (!secret.startsWith(WEBHOOK_SECRET_PREFIX)) {
    return { ok: false, reason: "prefix" };
  }
  const bytes = decodeBase64Loose(
    secret.slice(WEBHOOK_SECRET_PREFIX.length),
    false
  );
  if (!bytes || bytes.length === 0) return { ok: false, reason: "encoding" };
  if (
    bytes.length < MIN_WEBHOOK_SECRET_BYTES ||
    bytes.length > MAX_WEBHOOK_SECRET_BYTES
  ) {
    return { ok: false, reason: "length" };
  }
  return { ok: true, bytes };
}

/**
 * Parses a webhook secret leniently, for receivers that verify deliveries:
 * the `whsec_` prefix is optional, and standard or URL-safe base64, padded or
 * unpadded, is accepted, as long as it decodes to 24 to 64 bytes.
 *
 * @param s - The secret as the receiver stored it.
 * @returns The secret bytes, or `undefined` when the value is not a usable secret.
 */
export function parseWebhookSecret(s: string): Uint8Array | undefined {
  const text = s.startsWith(WEBHOOK_SECRET_PREFIX)
    ? s.slice(WEBHOOK_SECRET_PREFIX.length)
    : s;
  const bytes = decodeBase64Loose(text, false) ?? decodeBase64Loose(text, true);
  if (
    !bytes ||
    bytes.length < MIN_WEBHOOK_SECRET_BYTES ||
    bytes.length > MAX_WEBHOOK_SECRET_BYTES
  ) {
    return undefined;
  }
  return bytes;
}
