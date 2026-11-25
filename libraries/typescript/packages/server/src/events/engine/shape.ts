/**
 * Deliver-body shaping (D25): the body is serialized once per subscription
 * at job creation with the profile axes (fields eventId, name, timestamp,
 * data, cursor and optional _meta), and is byte-identical on every attempt.
 *
 * @internal
 */

import {
  generateWebhookId,
  normalizeEventIdHeaderSafe,
  type ProfileAxes,
} from "@mcp-use/events-core";

/** Normalize an event id per `eventIdNormalization`. */
export async function normalizeEventId(
  id: string,
  axes: ProfileAxes
): Promise<string> {
  return axes.eventIdNormalization === "headerSafe"
    ? normalizeEventIdHeaderSafe(id)
    : id;
}

/** Serialize one webhook event body. */
export function serializeEventBody(o: {
  eventId: string;
  name: string;
  timestamp: string;
  data: unknown;
  cursor: string | null;
  meta?: Record<string, unknown> | undefined;
}): string {
  const body: Record<string, unknown> = {
    eventId: o.eventId,
    name: o.name,
    timestamp: o.timestamp,
    data: o.data,
    cursor: o.cursor,
  };
  if (o.meta && Object.keys(o.meta).length > 0) body._meta = o.meta;
  return JSON.stringify(body);
}

/**
 * The `webhook-id` of an event delivery (D10): `eventId` axis → the
 * normalized eventId; otherwise `msg_` + 22 CSPRNG characters.
 */
export function eventWebhookId(
  normalizedEventId: string,
  axes: ProfileAxes
): string {
  return axes.webhookId === "eventId"
    ? normalizedEventId
    : generateWebhookId("event");
}

/** UTF-8 byte length of a body. */
export function byteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}
