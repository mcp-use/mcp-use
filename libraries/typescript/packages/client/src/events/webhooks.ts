/**
 * `@mcp-use/client/webhooks` (PLAN.md §9.3, §9.4): verify and parse MCP
 * Events webhook deliveries, and receive them.
 *
 * @packageDocumentation
 */

import {
  verifyWebhook,
  type VerifiedWebhook,
  type WebhookControlBody,
  type WebhookEventBody,
} from "@mcp-use/events-core";

export {
  WEBHOOK_HEADERS,
  WebhookVerificationError,
  generateWebhookSecret,
  parseWebhookSecret,
  validateWebhookSecret,
  verifyWebhook,
} from "@mcp-use/events-core";
export type {
  VerifiedWebhook,
  VerifyWebhookOptions,
  WebhookEventBody,
  WebhookControlBody,
} from "@mcp-use/events-core";
export { createWebhookHandler } from "./receiver.js";
export type {
  WebhookHandlerOptions,
  ReceiverSubscriptionState,
} from "./receiver.js";
export { listenForEvents } from "./listen.js";
export type { ListenForEventsOptions, EventsListener } from "./listen.js";

/** A verified, parsed delivery. */
export interface VerifiedWebhookRequest extends VerifiedWebhook {
  /** The parsed body: an event, or a control envelope (`type` present). */
  body: WebhookEventBody | WebhookControlBody;
}

/**
 * Verify a webhook `Request` against one or more secrets and return the
 * parsed body. Throws `WebhookVerificationError`.
 *
 * @param request - The incoming request (its body is read once).
 * @param secrets - Current and previous `whsec_` secrets.
 * @returns The verified headers and parsed body.
 */
export async function verifyWebhookRequest(
  request: Request,
  secrets: string | readonly string[]
): Promise<VerifiedWebhookRequest> {
  const body = new Uint8Array(await request.arrayBuffer());
  const verified = await verifyWebhook({
    secrets: typeof secrets === "string" ? [secrets] : secrets,
    headers: request.headers,
    body,
  });
  return {
    ...verified,
    body: JSON.parse(new TextDecoder().decode(body)) as
      | WebhookEventBody
      | WebhookControlBody,
  };
}
