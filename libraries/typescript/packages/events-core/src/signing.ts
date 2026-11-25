/**
 * Standard Webhooks `v1` (HMAC-SHA256) signing and verification on WebCrypto,
 * shared by the server's senders, the client's receivers and the conformance
 * runner. Asymmetric `v1a` signatures are not produced; verifiers ignore
 * signature versions they do not know.
 *
 * @packageDocumentation
 */

import {
  randomBytes,
  timingSafeEqual,
  toBase64,
  toBase64Url,
  utf8,
} from "./encoding.js";
import { parseWebhookSecret } from "./secrets.js";
import { SUBSCRIPTION_ID_HEADER, type WebhookControlBody } from "./wire.js";

/** The Standard Webhooks header names. */
export const WEBHOOK_HEADERS = {
  /** The message id; equal across retries of one message. */
  id: "webhook-id",
  /** Unix seconds of the attempt; regenerated on each attempt. */
  timestamp: "webhook-timestamp",
  /** Space-separated `v1,<base64>` signatures. */
  signature: "webhook-signature",
} as const;

/** The default freshness window of {@link verifyWebhook}, in seconds (5 minutes). */
export const DEFAULT_WEBHOOK_TOLERANCE_SEC = 300;

/**
 * Generates a `webhook-id`: `msg_` + 22 base64url characters (128 random bits)
 * for an event delivery, `msg_<type>_` + 22 characters for a control envelope.
 *
 * @param kind - `event` (default), or the control envelope type.
 * @returns A fresh webhook id.
 */
export function generateWebhookId(
  kind: "event" | WebhookControlBody["type"] = "event"
): string {
  const random = toBase64Url(randomBytes(16));
  return kind === "event" ? `msg_${random}` : `msg_${kind}_${random}`;
}

async function hmac(secret: Uint8Array, content: Uint8Array): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new Uint8Array(content)
  );
  return toBase64(new Uint8Array(mac));
}

function signedContent(
  id: string,
  timestampSec: number | string,
  body: Uint8Array
): Uint8Array {
  const prefix = utf8(`${id}.${timestampSec}.`);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

/**
 * Computes the `webhook-signature` header value:
 * `v1,` + base64(HMAC-SHA256(secret, id + "." + timestamp + "." + body)) for
 * each secret, space-separated. Pass the current and previous secret during a
 * rotation window.
 *
 * @param secrets - Secret bytes, current first (see {@link parseWebhookSecret}).
 * @param id - The `webhook-id`.
 * @param timestampSec - The `webhook-timestamp`, Unix seconds.
 * @param body - The exact body bytes sent.
 * @returns The header value, for example `v1,K5o…= v1,7Hk…=`.
 */
export async function signWebhook(
  secrets: readonly Uint8Array[],
  id: string,
  timestampSec: number,
  body: Uint8Array
): Promise<string> {
  const content = signedContent(id, timestampSec, body);
  const signatures = await Promise.all(
    secrets.map(async (secret) => `v1,${await hmac(secret, content)}`)
  );
  return signatures.join(" ");
}

/** Why {@link verifyWebhook} rejected a delivery. */
export type WebhookVerificationFailure =
  | "missing_headers"
  | "invalid_timestamp"
  | "timestamp_out_of_tolerance"
  | "no_valid_secret"
  | "invalid_signature";

/** Thrown by {@link verifyWebhook} when a delivery does not verify. */
export class WebhookVerificationError extends Error {
  /** Why the delivery was rejected. */
  readonly reason: WebhookVerificationFailure;

  /**
   * @param reason - Why the delivery was rejected.
   * @param message - A description.
   */
  constructor(reason: WebhookVerificationFailure, message: string) {
    super(message);
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

/** A delivery that verified. */
export interface VerifiedWebhook {
  /** The `webhook-id` header; deduplicate on it. */
  webhookId: string;
  /** The `webhook-timestamp` header, Unix seconds. */
  timestamp: number;
  /** The `X-MCP-Subscription-Id` header, or `null` when absent. */
  subscriptionId: string | null;
}

/** Options of {@link verifyWebhook}. */
export interface VerifyWebhookOptions {
  /** Candidate secrets (`whsec_…`); the delivery verifies when any signature matches any of them. */
  secrets: readonly string[];
  /** The request headers. */
  headers: Headers;
  /** The raw body bytes exactly as received. */
  body: Uint8Array;
  /** Freshness window in seconds, both directions; default 300. */
  toleranceSec?: number;
  /** The current time in epoch milliseconds; default `Date.now()`. */
  now?: number;
}

/**
 * Verifies a Standard Webhooks delivery: the three `webhook-*` headers are
 * present, the timestamp is within the tolerance, and at least one `v1,`
 * signature matches one of the secrets (constant-time comparison). Other
 * signature versions such as `v1a,` are ignored.
 *
 * @param o - Secrets, headers, raw body, tolerance and clock.
 * @returns The webhook id, timestamp and subscription id.
 * @throws {@link WebhookVerificationError} when the delivery does not verify.
 */
export async function verifyWebhook(
  o: VerifyWebhookOptions
): Promise<VerifiedWebhook> {
  const id = o.headers.get(WEBHOOK_HEADERS.id);
  const ts = o.headers.get(WEBHOOK_HEADERS.timestamp);
  const signatureHeader = o.headers.get(WEBHOOK_HEADERS.signature);
  if (!id || !ts || !signatureHeader) {
    throw new WebhookVerificationError(
      "missing_headers",
      "webhook-id, webhook-timestamp and webhook-signature are required"
    );
  }
  if (!/^\d{1,12}$/.test(ts)) {
    throw new WebhookVerificationError(
      "invalid_timestamp",
      "webhook-timestamp is not a Unix timestamp in seconds"
    );
  }
  const timestamp = Number(ts);
  const nowSec = Math.floor((o.now ?? Date.now()) / 1000);
  const tolerance = o.toleranceSec ?? DEFAULT_WEBHOOK_TOLERANCE_SEC;
  if (Math.abs(nowSec - timestamp) > tolerance) {
    throw new WebhookVerificationError(
      "timestamp_out_of_tolerance",
      "webhook-timestamp is outside the tolerance window"
    );
  }
  const secrets = o.secrets
    .map(parseWebhookSecret)
    .filter((s): s is Uint8Array => s !== undefined);
  if (secrets.length === 0) {
    throw new WebhookVerificationError(
      "no_valid_secret",
      "none of the configured secrets is a valid webhook secret"
    );
  }
  const offered = signatureHeader
    .split(" ")
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => entry.slice(3));
  const content = signedContent(id, ts, o.body);
  for (const secret of secrets) {
    const expected = await hmac(secret, content);
    // Compare against every offered signature so timing does not reveal which matched.
    let matched = false;
    for (const candidate of offered) {
      if (timingSafeEqual(candidate, expected)) matched = true;
    }
    if (matched) {
      return {
        webhookId: id,
        timestamp,
        subscriptionId: o.headers.get(SUBSCRIPTION_ID_HEADER),
      };
    }
  }
  throw new WebhookVerificationError(
    "invalid_signature",
    "no webhook-signature matches the configured secrets"
  );
}
