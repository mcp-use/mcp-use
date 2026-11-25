/**
 * SSE frames of `events/stream` (D52, PLAN.md §6.11): one `data:` line per
 * JSON-RPC message, the framing the SDK client parses for request-scoped SSE.
 * Never an `id:` line, never a comment line.
 *
 * @internal
 */

import {
  EVENTS_NOTIFICATIONS,
  SUBSCRIPTION_ID_META_KEY,
} from "@mcp-use/events-core";
import type { EventEnvelope, JsonRpcErrorObject } from "@mcp-use/events-core";

/** A JSON-RPC request id. */
export type RpcId = string | number;

/** Encodes one JSON-RPC message as an SSE `data:` frame. */
export function sseFrame(message: unknown): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

function meta(id: RpcId, own?: Record<string, unknown>): Record<string, unknown> {
  return { ...(own ?? {}), [SUBSCRIPTION_ID_META_KEY]: id };
}

function notification(method: string, params: unknown): string {
  return sseFrame({ jsonrpc: "2.0", method, params });
}

/** `notifications/events/active`. */
export function activeFrame(
  id: RpcId,
  p: { cursor: string | null; truncated: boolean; heartbeatMs: number }
): string {
  return notification(EVENTS_NOTIFICATIONS.active, { ...p, _meta: meta(id) });
}

/** `notifications/events/event`; the event `_meta` is merged, the subscription id wins. */
export function eventFrame(
  id: RpcId,
  env: EventEnvelope,
  cursor: string | null
): string {
  const { _meta, ...rest } = env;
  return notification(EVENTS_NOTIFICATIONS.event, {
    ...rest,
    cursor,
    _meta: meta(id, _meta),
  });
}

/** `notifications/events/heartbeat`. */
export function heartbeatFrame(id: RpcId, cursor: string | null): string {
  return notification(EVENTS_NOTIFICATIONS.heartbeat, {
    cursor,
    _meta: meta(id),
  });
}

/** `notifications/events/error`. */
export function errorFrame(id: RpcId, error: JsonRpcErrorObject): string {
  return notification(EVENTS_NOTIFICATIONS.error, { error, _meta: meta(id) });
}

/** `notifications/events/terminated`. */
export function terminatedFrame(id: RpcId, error: JsonRpcErrorObject): string {
  return notification(EVENTS_NOTIFICATIONS.terminated, {
    error,
    _meta: meta(id),
  });
}

/** The final result frame. */
export function resultFrame(id: RpcId): string {
  return sseFrame({
    jsonrpc: "2.0",
    id,
    result: { resultType: "complete", _meta: meta(id) },
  });
}

/** Response headers of an `events/stream` response. */
export const STREAM_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
  "x-mcp-use-events-dialect": "sep-3415",
};
