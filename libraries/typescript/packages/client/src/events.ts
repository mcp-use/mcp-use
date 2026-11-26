/**
 * MCP Events client helpers (ChatGPT dialect, webhook delivery): list,
 * subscribe (also used to refresh), unsubscribe, and a Fetch-style webhook
 * receiver that verifies Standard Webhooks signatures, answers the callback
 * verification challenge and drops duplicate `eventId`s.
 *
 * @packageDocumentation
 */

/** Anything with a raw JSON-RPC `request`, such as an `MCPSession`. */
export interface EventsRequester {
  request(
    method: string,
    params: Record<string, unknown> | null
  ): Promise<unknown>;
}

/** An event definition returned by `events/list`. */
export interface EventInfo {
  name: string;
  description?: string;
  delivery: string[];
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
}

/** An event delivered to a webhook. */
export interface EventEnvelope<T = unknown> {
  eventId: string;
  name: string;
  timestamp: string;
  data: T;
  cursor: string | null;
}

/** Result of {@link subscribeEvent}. */
export interface SubscribeResult {
  id: string;
  /** Re-subscribe before this time to keep the subscription; `null` = no expiry. */
  refreshBefore: string | null;
  cursor: string | null;
  truncated: boolean;
}

/** Parameters of {@link subscribeEvent}. */
export interface SubscribeParams {
  name: string;
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
  const result = (await session.request("events/list", {})) as {
    events?: EventInfo[];
  };
  return result.events ?? [];
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
    name: params.name,
    arguments: params.arguments ?? {},
    delivery: { mode: "webhook", url: params.url, secret: params.secret },
    cursor: null,
    ...(params.ttlMs !== undefined && { ttlMs: params.ttlMs }),
  })) as SubscribeResult;
}

/**
 * Remove a subscription (idempotent).
 *
 * @param session - A connected session.
 * @param params - Event name, arguments and callback URL used to subscribe.
 */
export async function unsubscribeEvent(
  session: EventsRequester,
  params: Omit<SubscribeParams, "secret" | "ttlMs">
): Promise<void> {
  await session.request("events/unsubscribe", {
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
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(fromBase64(secret.slice(6))),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
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
  /** Called once per new `eventId`. */
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
  const seen = new Set<string>();
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
    if (!seen.has(event.eventId)) {
      seen.add(event.eventId);
      if (seen.size > max) seen.delete(seen.values().next().value as string);
      try {
        await options.onEvent(
          event,
          request.headers.get("x-mcp-subscription-id")
        );
      } catch (error) {
        seen.delete(event.eventId); // let the retry through
        throw error;
      }
    }
    return Response.json({});
  };
}
