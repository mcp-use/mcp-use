/**
 * Layer 3 webhook receiver (PLAN.md §9.4): `createWebhookHandler`.
 *
 * @packageDocumentation
 */

import {
  MAX_ENVELOPE_BYTES,
  SUBSCRIPTION_ID_HEADER,
  WebhookVerificationError,
  verifyWebhook,
  type EventEnvelope,
} from "@mcp-use/events-core";
import { LruSet } from "./dedupe.js";

/** What the receiver knows about one subscription. */
export interface ReceiverSubscriptionState {
  /** `pending`: the subscribe is in flight (503). `cancelled`: 410. */
  state: "active" | "pending" | "cancelled";
  /** Candidate secrets (current and previous). */
  secrets: readonly string[];
}

/** Options of {@link createWebhookHandler}. */
export interface WebhookHandlerOptions {
  /** Resolve a subscription id; `undefined` means unknown (410). */
  resolve(
    subscriptionId: string
  ): Promise<ReceiverSubscriptionState | undefined>;
  /** Deliver one event; the 2xx is sent only after it resolves. */
  onEvent(
    event: EventEnvelope,
    info: { subscriptionId: string; webhookId: string }
  ): Promise<void>;
  /** A `gap` control envelope. */
  onGap?(info: {
    subscriptionId: string;
    cursor: string | null;
  }): Promise<void>;
  /** A `terminated` control envelope. */
  onTerminated?(info: {
    subscriptionId: string;
    error: { code: number; message: string; data?: unknown };
  }): Promise<void>;
  /** Persist body cursors, called after `onEvent` resolves. */
  onCursor?(info: {
    subscriptionId: string;
    cursor: string | null;
  }): Promise<void>;
  /** Bind a pending subscription on a verified `verification` challenge. */
  bindPending?(challenge: {
    subscriptionId: string;
    body: Uint8Array;
    headers: Headers;
  }): Promise<boolean>;
  /** Dedupe; default an in-memory LRU of 4,096 keys. `forget` is called when `onEvent` throws so the retry is dispatched. */
  dedupe?: {
    seen(key: string): Promise<boolean>;
    forget?(key: string): Promise<void>;
  };
  /** Clock for tests (epoch ms). */
  now?: () => number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Create a `(Request) => Promise<Response>` webhook receiver.
 *
 * @param options - Resolution, delivery callbacks and dedupe.
 * @returns The request handler (mount it where nothing pre-parses JSON).
 */
export function createWebhookHandler(
  options: WebhookHandlerOptions
): (request: Request) => Promise<Response> {
  const lru = new LruSet();
  const seen =
    options.dedupe?.seen.bind(options.dedupe) ??
    (async (k: string) => lru.seen(k));
  const forget = async (k: string): Promise<void> => {
    if (options.dedupe) await options.dedupe.forget?.(k);
    else lru.forget(k);
  };

  return async (request) => {
    if ((request as { body?: unknown }).body !== null && isPreParsed(request)) {
      return json(500, {
        error:
          "The webhook receiver needs the raw body; mount it before any JSON body parser",
      });
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_ENVELOPE_BYTES) return json(413, { error: "too_large" });
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > MAX_ENVELOPE_BYTES) {
      return json(413, { error: "too_large" });
    }
    const subscriptionId = request.headers.get(SUBSCRIPTION_ID_HEADER);
    if (
      !request.headers.get("webhook-id") ||
      !request.headers.get("webhook-timestamp") ||
      !request.headers.get("webhook-signature")
    ) {
      return json(400, { error: "missing_headers" });
    }
    if (!subscriptionId) return json(400, { error: "missing_subscription_id" });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body)) as Record<
        string,
        unknown
      >;
    } catch {
      return json(400, { error: "invalid_json" });
    }

    const state = await options.resolve(subscriptionId);
    const verifyWith = async (secrets: readonly string[]) =>
      verifyWebhook({
        secrets,
        headers: request.headers,
        body,
        ...(options.now ? { now: options.now() } : {}),
      });

    if (parsed.type === "verification") {
      if (!state || state.state === "cancelled") {
        return json(410, { error: "gone" });
      }
      try {
        await verifyWith(state.secrets);
      } catch (err) {
        return verificationFailure(err);
      }
      if (state.state === "pending" && options.bindPending) {
        const ok = await options.bindPending({
          subscriptionId,
          body,
          headers: request.headers,
        });
        if (!ok) return json(410, { error: "gone" });
      }
      return json(200, { challenge: parsed.challenge });
    }

    if (!state || state.state === "cancelled") {
      return json(410, { error: "gone" });
    }
    if (state.state === "pending") {
      return json(503, { error: "pending" });
    }
    let verified: Awaited<ReturnType<typeof verifyWith>>;
    try {
      verified = await verifyWith(state.secrets);
    } catch (err) {
      return verificationFailure(err);
    }

    const whKey = `${subscriptionId}\u0000wh\u0000${verified.webhookId}`;
    if (await seen(whKey)) {
      return json(200, { ok: true, duplicate: true });
    }

    if (parsed.type === "gap") {
      const cursor = typeof parsed.cursor === "string" ? parsed.cursor : null;
      await options.onGap?.({ subscriptionId, cursor });
      await options.onCursor?.({ subscriptionId, cursor });
      return json(200, { ok: true });
    }
    if (parsed.type === "terminated") {
      await options.onTerminated?.({
        subscriptionId,
        error: parsed.error as {
          code: number;
          message: string;
          data?: unknown;
        },
      });
      return json(200, { ok: true });
    }
    if (typeof parsed.type === "string") {
      return json(200, { ok: true, ignored: parsed.type });
    }

    const event = parsed as unknown as EventEnvelope;
    const evKey =
      typeof event.eventId === "string"
        ? `${subscriptionId}\u0000ev\u0000${event.eventId}`
        : undefined;
    if (evKey !== undefined && (await seen(evKey))) {
      return json(200, { ok: true, duplicate: true });
    }
    try {
      await options.onEvent(event, {
        subscriptionId,
        webhookId: verified.webhookId,
      });
    } catch {
      await forget(whKey);
      if (evKey !== undefined) await forget(evKey);
      return json(500, { error: "handler_failed" });
    }
    if (event.cursor !== undefined) {
      await options.onCursor?.({
        subscriptionId,
        cursor: event.cursor ?? null,
      });
    }
    return json(200, { ok: true });
  };
}

function isPreParsed(request: Request): boolean {
  const r = request as unknown as { bodyUsed?: boolean };
  return r.bodyUsed === true;
}

function verificationFailure(err: unknown): Response {
  if (err instanceof WebhookVerificationError) {
    if (err.reason === "missing_headers") {
      return json(400, { error: err.reason });
    }
    return json(401, { error: err.reason });
  }
  return json(401, { error: "bad_signature" });
}
