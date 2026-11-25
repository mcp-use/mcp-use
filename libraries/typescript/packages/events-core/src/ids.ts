/**
 * Subscription ids, direct ids and header-safe event ids (D11, D23, D85).
 *
 * @packageDocumentation
 */

import { canonicalJson } from "./jcs.js";
import { sha256, toBase64Url, utf8 } from "./encoding.js";

/** Every subscription id and direct id matches this pattern: `sub_` + 22 base64url characters. */
export const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9_-]{22}$/;

/** The callback URL that stands in for poll and push subscriptions when deriving a direct id. */
export const DIRECT_SUBSCRIPTION_URL = "urn:mcp-use:events:direct";

/** Event ids matching this pattern are already header-safe and are never normalized. */
export const HEADER_SAFE_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Normalizes subscription arguments the way the subscription key does:
 * absent (`undefined`) and `null` become `{}`; any other value is returned as is.
 *
 * @param a - `params.arguments` as received.
 * @returns The arguments with `undefined` and `null` replaced by `{}`.
 */
export function normalizeArguments(a: unknown): Record<string, unknown> {
  return a === undefined || a === null ? {} : (a as Record<string, unknown>);
}

/** The key a subscription id is derived from. */
export interface SubscriptionKey {
  /** The principal that owns the subscription (`iss|sub`, `dev|local` or `anonymous`). */
  principal: string;
  /** The callback URL exactly as the client sent it. */
  url: string;
  /** The event name. */
  name: string;
  /** `params.arguments` as received; absent and `null` mean `{}`. */
  arguments?: unknown;
}

/**
 * Derives a webhook subscription id with the SDK's formula (PR #3209):
 * `sub_` + the first 22 characters of
 * `base64url(SHA-256(canonicalJson([principal, url, name, arguments ?? {}])))`.
 * The same key always gives the same id, on every replica and across restarts.
 *
 * @param k - The subscription key.
 * @returns The subscription id.
 */
export async function deriveSubscriptionId(
  k: SubscriptionKey
): Promise<`sub_${string}`> {
  const key = canonicalJson([
    k.principal,
    k.url,
    k.name,
    normalizeArguments(k.arguments),
  ]);
  const digest = await sha256(utf8(key));
  return `sub_${toBase64Url(digest).slice(0, 22)}`;
}

/**
 * Derives the direct id of a poll or push subscription: the subscription-id
 * formula with url {@link DIRECT_SUBSCRIPTION_URL}. It cannot collide with a
 * webhook id and is the same for poll and push for one `(principal, name, arguments)`.
 *
 * @param k - The principal, event name and arguments.
 * @returns The direct id.
 */
export function deriveDirectId(k: {
  /** The principal. */
  principal: string;
  /** The event name. */
  name: string;
  /** `params.arguments` as received; absent and `null` mean `{}`. */
  arguments?: unknown;
}): Promise<`sub_${string}`> {
  return deriveSubscriptionId({
    principal: k.principal,
    url: DIRECT_SUBSCRIPTION_URL,
    name: k.name,
    arguments: k.arguments,
  });
}

/**
 * Makes an event id header-safe (D11, the `headerSafe` value of the
 * `eventIdNormalization` axis): ids matching
 * {@link HEADER_SAFE_EVENT_ID_PATTERN} are returned unchanged; any other id
 * becomes `evt_` + the first 27 characters of base64url(SHA-256(id)).
 *
 * @param id - The upstream event id.
 * @returns A header-safe event id.
 */
export async function normalizeEventIdHeaderSafe(id: string): Promise<string> {
  if (HEADER_SAFE_EVENT_ID_PATTERN.test(id)) return id;
  const digest = await sha256(utf8(id));
  return `evt_${toBase64Url(digest).slice(0, 27)}`;
}
