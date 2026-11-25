/**
 * The `WebhookSender` seam (D14, §8.15).
 *
 * TODO(events): WP-03 owns the public `mcp-use/events` type surface; it
 * should re-export these from there (or move them) without changing them.
 */

/** A request handed to a {@link WebhookSender}. */
export interface WebhookSendRequest {
  /** Absolute callback URL. */
  url: string;
  /** Request headers (signature headers, content type). */
  headers: Readonly<Record<string, string>>;
  /** The serialized body, sent as is. */
  body: string;
  /**
   * `true` only for dev trusted origins (the local Inspector inbox, D33):
   * the address checks and the egress proxy are bypassed.
   */
  trusted: boolean;
  /** Aborts the attempt; an abort is reported as `timeout`. */
  signal: AbortSignal;
}

/** A response received from the callback URL. */
export interface WebhookSendResponse {
  /** HTTP status code (never 3xx: redirects are reported as an error). */
  status: number;
  /** The first 4 KiB of the response body at most, decoded as UTF-8. */
  body: string;
  /** `Retry-After`, in milliseconds, when the receiver sent a valid one. */
  retryAfterMs?: number;
}

/**
 * Why no response was received. `blocked_address`, `dns_failure` and
 * `redirect` are internal precision only: on the wire all three are
 * `connection_refused` ({@link wireErrorCategory}).
 */
export type WebhookSendErrorCategory =
  | "connection_refused"
  | "timeout"
  | "tls_error"
  | "dns_failure"
  | "blocked_address"
  | "redirect";

/** A failed attempt. */
export interface WebhookSendError {
  /** The failure category. */
  error: WebhookSendErrorCategory;
}

/**
 * Sends one webhook POST. Same shape as the official TypeScript SDK's
 * `WebhookSender` (typescript-sdk #3209), with precise internal error
 * categories. Implementations never follow redirects and never throw for
 * network failures.
 */
export type WebhookSender = (
  request: WebhookSendRequest
) => Promise<WebhookSendResponse | WebhookSendError>;

/**
 * Maps a sender error category to the category reported on the wire
 * (`deliveryStatus.lastError`, CallbackEndpointError `reason`), so the
 * reason cannot be used as an address-probing oracle.
 */
export function wireErrorCategory(
  category: WebhookSendErrorCategory
): "connection_refused" | "timeout" | "tls_error" {
  return category === "timeout" || category === "tls_error"
    ? category
    : "connection_refused";
}

/** Error thrown by sender factories for an invalid configuration. */
export class EventsSenderConfigError extends Error {
  /** Always `EVENTS_CONFIG_INVALID`. */
  readonly code = "EVENTS_CONFIG_INVALID";
  /** The offending configuration field. */
  readonly data: { field: string };
  /** @param field - The offending field. @param message - What is wrong. */
  constructor(field: string, message: string) {
    super(message);
    this.name = "EventsSenderConfigError";
    this.data = { field };
  }
}

/** Default limits shared by the senders (§8.15). */
export const SENDER_LIMITS = {
  /** Connect, including the CONNECT to an egress proxy and TLS. */
  connectTimeoutMs: 5_000,
  /** Whole attempt. */
  totalTimeoutMs: 10_000,
  /** Response body bytes read. */
  maxResponseBytes: 4 * 1024,
} as const;

/** Parses `Retry-After` (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now()
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}
