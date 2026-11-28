/**
 * MCP Events client helpers: list, poll (official extension), subscribe
 * (also used to refresh), unsubscribe, and a Fetch-style webhook receiver
 * that verifies Standard Webhooks signatures, answers the callback
 * verification challenge and drops duplicate deliveries.
 *
 * @packageDocumentation
 */

import { encodeMcpHeaderValue } from "./transport/mcp-param-headers.js";

/** Extension id of the official MCP Events extension. */
export const EVENTS_EXTENSION_ID = "io.modelcontextprotocol/events";

/**
 * Request `_meta` declaring the official Events extension, so servers pick
 * the official dialect even without the `Mcp-Name` header (stdio).
 */
const EVENTS_META = {
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: { [EVENTS_EXTENSION_ID]: {} },
  },
};

/** Anything with a raw JSON-RPC `request`, such as an `MCPSession`. */
export interface EventsRequester {
  /** Send a JSON-RPC request and resolve with its `result`. */
  request(
    method: string,
    params: Record<string, unknown> | null
  ): Promise<unknown>;
}

/** An event definition returned by `events/list`. */
export interface EventInfo {
  /** Event name, used in poll and subscribe requests. */
  name: string;
  /** Human-readable description from the server. */
  description?: string;
  /** Delivery modes the server supports for this event, such as `webhook` and `poll`. */
  delivery: string[];
  /** JSON Schema of the subscription `arguments`. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema of each event's `data`. */
  payloadSchema: Record<string, unknown>;
}

/** An event delivered to a webhook or returned by a poll. */
export interface EventEnvelope<T = unknown> {
  /** Unique, stable id; use it to drop duplicate deliveries. */
  eventId: string;
  /** Name of the event that occurred. */
  name: string;
  /** Occurrence time as an ISO 8601 string. */
  timestamp: string;
  /** Event payload, matching the event's `payloadSchema`. */
  data: T;
  /** Poll position just after this event, when the server reports one. */
  cursor?: string | null;
}

/** Parameters of {@link pollEvents}. */
export interface PollParams {
  /** Event to poll. */
  name: string;
  /** Subscription arguments that filter which events are returned. */
  arguments?: Record<string, unknown>;
  /** Cursor from the previous poll; `null` starts from now. */
  cursor?: string | null;
  /** Skip events older than this many ms when resuming. */
  maxAgeMs?: number;
  /** Cap on events returned. */
  maxEvents?: number;
}

/** Result of {@link pollEvents}. */
export interface PollResult<T = unknown> {
  /** Events after the supplied cursor, oldest first. */
  events: EventEnvelope<T>[];
  /** Pass back on the next poll. */
  cursor: string | null;
  /** Events may have been skipped since the supplied cursor. */
  truncated: boolean;
  /** More events are waiting: poll again now. */
  hasMore: boolean;
  /** Suggested delay before the next poll. */
  nextPollMs: number;
}

/** Result of {@link subscribeEvent}. */
export interface SubscribeResult {
  /** Subscription id, also sent in each delivery's `x-mcp-subscription-id` header. */
  id: string;
  /** Re-subscribe before this time to keep the subscription; `null` = no expiry. */
  refreshBefore: string | null;
  /** Poll position at subscribe time, when the server reports one; otherwise `null`. */
  cursor: string | null;
  /** Events may have been skipped since a previous subscription; `false` when unknown. */
  truncated: boolean;
}

/** Parameters of {@link subscribeEvent}. */
export interface SubscribeParams {
  /** Event to subscribe to. */
  name: string;
  /** Subscription arguments that filter which events are delivered. */
  arguments?: Record<string, unknown>;
  /** HTTPS callback URL. */
  url: string;
  /** `whsec_` secret the server signs deliveries with. */
  secret: string;
  /** Requested lifetime in ms; `null` asks for no expiry. */
  ttlMs?: number | null;
}

/**
 * Create a random `whsec_` secret (32 bytes).
 */
export function generateWebhookSecret(): string {
  return `whsec_${toBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/**
 * List the events a server publishes.
 *
 * @param session - A connected session.
 */
export async function listEvents(
  session: EventsRequester
): Promise<EventInfo[]> {
  const result = (await session.request("events/list", {
    _meta: EVENTS_META,
  })) as {
    events?: EventInfo[];
  };
  return result.events ?? [];
}

/**
 * Poll an event (official extension). Start with `cursor: null`, then pass
 * back the returned cursor; poll again at once while `hasMore` is true, else
 * after `nextPollMs`.
 *
 * @param session - A connected session.
 * @param params - Event, filters and cursor.
 */
export async function pollEvents<T = unknown>(
  session: EventsRequester,
  params: PollParams
): Promise<PollResult<T>> {
  return (await session.request("events/poll", {
    _meta: EVENTS_META,
    name: params.name,
    arguments: params.arguments ?? {},
    cursor: params.cursor ?? null,
    ...(params.maxAgeMs !== undefined && { maxAgeMs: params.maxAgeMs }),
    ...(params.maxEvents !== undefined && { maxEvents: params.maxEvents }),
  })) as PollResult<T>;
}

/**
 * Set `Mcp-Name` on outgoing `events/*` requests (SEP-2243), which the SDK
 * client does not do for custom methods. Wraps a Streamable HTTP fetch.
 *
 * @param base - The fetch to wrap.
 */
export function withEventsHeaders(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const body = init?.body;
    if (typeof body === "string" && body.includes('"events/')) {
      try {
        const m = JSON.parse(body) as {
          method?: unknown;
          params?: { name?: unknown };
        };
        const name = m.params?.name;
        if (
          typeof m.method === "string" &&
          m.method.startsWith("events/") &&
          typeof name === "string"
        ) {
          const headers = new Headers(init?.headers);
          headers.set("mcp-name", encodeMcpHeaderValue(name));
          return base(input, { ...init, headers });
        }
      } catch {
        // not JSON-RPC; send as is
      }
    }
    return base(input, init);
  };
}

/**
 * Subscribe a webhook to an event. Call again with the same name, arguments
 * and URL before `refreshBefore` to refresh (or to rotate the secret).
 *
 * @param session - A connected session.
 * @param params - Event, filters, callback URL, secret and lifetime.
 */
export async function subscribeEvent(
  session: EventsRequester,
  params: SubscribeParams
): Promise<SubscribeResult> {
  return (await session.request("events/subscribe", {
    _meta: EVENTS_META,
    name: params.name,
    arguments: params.arguments ?? {},
    delivery: { mode: "webhook", url: params.url, secret: params.secret },
    cursor: null,
    ...(params.ttlMs !== undefined && { ttlMs: params.ttlMs }),
  })) as SubscribeResult;
}

/**
 * Remove a subscription. The official dialect answers `-32023` when it does
 * not exist; the ChatGPT dialect ignores unknown subscriptions.
 *
 * @param session - A connected session.
 * @param params - Event name, arguments and callback URL used to subscribe.
 */
export async function unsubscribeEvent(
  session: EventsRequester,
  params: Omit<SubscribeParams, "secret" | "ttlMs">
): Promise<void> {
  await session.request("events/unsubscribe", {
    _meta: EVENTS_META,
    name: params.name,
    arguments: params.arguments ?? {},
    delivery: { mode: "webhook", url: params.url },
  });
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i % Math.max(b.length, 1));
  return diff === 0;
}

/**
 * Verify a Standard Webhooks `v1` signature.
 *
 * @param secrets - Accepted `whsec_` secrets.
 * @param headers - Request headers.
 * @param body - The raw body text.
 * @param toleranceSec - Allowed clock skew; default 300 s.
 * @returns `true` when a signature matches and the timestamp is fresh.
 */
export async function verifyWebhookSignature(
  secrets: readonly string[],
  headers: Headers,
  body: string,
  toleranceSec = 300
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sig = headers.get("webhook-signature");
  if (!id || !ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  const offered = sig
    .split(" ")
    .filter((s) => s.startsWith("v1,"))
    .map((s) => s.slice(3));
  const content = new TextEncoder().encode(`${id}.${ts}.${body}`);
  for (const secret of secrets) {
    if (!secret.startsWith("whsec_")) continue;
    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(fromBase64(secret.slice(6))),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
    } catch {
      continue; // malformed secret: it can match nothing
    }
    const mac = toBase64(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, content))
    );
    if (offered.some((o) => safeEqual(o, mac))) return true;
  }
  return false;
}

/** Options for {@link createWebhookReceiver}. */
export interface WebhookReceiverOptions {
  /** Accepted secrets (current first, plus the previous one while rotating). */
  secrets: readonly string[];
  /**
   * Called once per new delivery, keyed by `eventId` per subscription
   * (`x-mcp-subscription-id`); the `webhook-id` header is not used.
   */
  onEvent: (
    event: EventEnvelope,
    subscriptionId: string | null
  ) => void | Promise<void>;
  /** How many recent `eventId`s to remember for deduplication; default 1000. */
  dedupeSize?: number;
}

/**
 * Build a Fetch handler for an MCP Events callback URL: rejects bad
 * signatures with 401, echoes verification challenges, deduplicates by
 * `eventId`, and answers 2xx after `onEvent` runs.
 *
 * @param options - Secrets and the event callback.
 */
export function createWebhookReceiver(
  options: WebhookReceiverOptions
): (request: Request) => Promise<Response> {
  // Value: the in-flight (or finished) onEvent run for that delivery, so a
  // duplicate that arrives while it runs gets the same outcome.
  const seen = new Map<string, Promise<void>>();
  const max = options.dedupeSize ?? 1000;
  return async (request) => {
    const body = await request.text();
    if (!(await verifyWebhookSignature(options.secrets, request.headers, body)))
      return new Response("invalid signature", { status: 401 });
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return new Response("invalid JSON", { status: 400 });
    }
    if (parsed.type === "verification")
      return Response.json({ challenge: parsed.challenge });
    if (parsed.type !== undefined) return Response.json({});
    const event = parsed as unknown as EventEnvelope;
    const subscriptionId = request.headers.get("x-mcp-subscription-id");
    // The same eventId on two subscriptions is two deliveries.
    const key = `${subscriptionId ?? ""}\n${event.eventId}`;
    let run = seen.get(key);
    if (run === undefined) {
      run = (async () => options.onEvent(event, subscriptionId))();
      seen.set(key, run);
      if (seen.size > max) seen.delete(seen.keys().next().value as string);
      // Forget a failed run so the next retry calls onEvent again.
      run.catch(() => {
        if (seen.get(key) === run) seen.delete(key);
      });
    }
    await run;
    return Response.json({});
  };
}
