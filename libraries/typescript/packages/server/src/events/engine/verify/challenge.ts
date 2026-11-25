/**
 * Challenge-echo strategy (D29): a signed POST
 * `{"type":"verification","challenge":"<32 random bytes b64url>"}` with
 * `webhook-id: msg_verification_<22>`; success is a 2xx whose JSON
 * `challenge` equals the nonce, compared in constant time. A byte-equal
 * reflection of the request body is accepted with `warning: "reflected"`
 * under anti-reflection `"warn"` (default) and rejected under `"reject"`.
 *
 * @internal
 */

import {
  generateWebhookId,
  parseWebhookSecret,
  signWebhook,
  WEBHOOK_HEADERS,
  type DeliveryErrorCategory,
} from "@mcp-use/events-core";
import type { Clock } from "../../internal/clock.js";
import type { WebhookSender, WebhookSendResult } from "../../types.js";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Outcome of one challenge. */
export type ChallengeOutcome =
  | {
      ok: true;
      warning?: "reflected";
      status: number;
      ms: number;
      webhookId: string;
    }
  | {
      ok: false;
      reason: DeliveryErrorCategory;
      status?: number;
      ms: number;
      webhookId: string;
    };

/** Inputs of {@link runChallenge}. */
export interface ChallengeInput {
  url: string;
  secret: string;
  subscriptionId: string;
  send: WebhookSender["send"];
  clock: Clock;
  timeoutMs: number;
  connectTimeoutMs: number;
  antiReflection: "warn" | "reject";
  signal?: AbortSignal;
}

/** Send one verification challenge and judge the response. */
export async function runChallenge(
  o: ChallengeInput
): Promise<ChallengeOutcome> {
  const challenge = toBase64Url(o.clock.randomBytes(32));
  const body = JSON.stringify({ type: "verification", challenge });
  const webhookId = generateWebhookId("verification");
  const ts = Math.floor(o.clock.now() / 1000);
  const key = parseWebhookSecret(o.secret);
  const signature = await signWebhook(
    key ? [key] : [],
    webhookId,
    ts,
    new TextEncoder().encode(body)
  );
  let r: WebhookSendResult;
  try {
    r = await o.send({
      url: o.url,
      headers: {
        "content-type": "application/json",
        [WEBHOOK_HEADERS.id]: webhookId,
        [WEBHOOK_HEADERS.timestamp]: String(ts),
        [WEBHOOK_HEADERS.signature]: signature,
        "x-mcp-subscription-id": o.subscriptionId,
      },
      body,
      timeoutMs: o.timeoutMs,
      connectTimeoutMs: Math.min(o.connectTimeoutMs, o.timeoutMs),
      ...(o.signal ? { signal: o.signal } : {}),
    });
  } catch {
    return { ok: false, reason: "connection_refused", ms: 0, webhookId };
  }
  if (!r.ok) return { ok: false, reason: r.error, ms: r.ms, webhookId };
  const fail = (reason: DeliveryErrorCategory): ChallengeOutcome => ({
    ok: false,
    reason,
    status: r.status,
    ms: r.ms,
    webhookId,
  });
  if (r.status >= 300 && r.status < 400) return fail("connection_refused");
  if (r.status < 200 || r.status >= 300)
    return fail(r.status >= 500 ? "http_5xx" : "http_4xx");
  let echoed: unknown;
  try {
    echoed = (JSON.parse(r.body) as { challenge?: unknown }).challenge;
  } catch {
    echoed = undefined;
  }
  if (typeof echoed !== "string" || !constantTimeEqual(echoed, challenge))
    return fail("challenge_failed");
  if (r.body === body) {
    if (o.antiReflection === "reject") return fail("challenge_failed");
    return {
      ok: true,
      warning: "reflected",
      status: r.status,
      ms: r.ms,
      webhookId,
    };
  }
  return { ok: true, status: r.status, ms: r.ms, webhookId };
}
