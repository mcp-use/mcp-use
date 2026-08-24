import { getRpcTrafficMethod } from "./rpc-traffic-coalesce";
import type { RpcTrafficEntry } from "./rpc-traffic-store";

type RpcRequestId = string | number;

interface PendingRpcRequest {
  method: string;
  timestampMs: number;
}

export interface RpcTrafficResponseLabel {
  method: string;
  latencyMs: number;
  outcome: "result" | "error";
}

export function buildRpcTrafficResponseLabels(
  entries: readonly RpcTrafficEntry[]
): ReadonlyMap<string, RpcTrafficResponseLabel> {
  const pendingRequests = new Map<string, PendingRpcRequest>();
  const responseLabels = new Map<string, RpcTrafficResponseLabel>();

  entries.forEach((entry) => {
    const message = entry.message as {
      id?: unknown;
      result?: unknown;
      error?: unknown;
    };
    const rpcId = getRpcRequestId(message?.id);
    if (rpcId === null) return;

    const method = getRpcTrafficMethod(entry.message);
    if (method) {
      const timestampMs = Date.parse(entry.timestamp);
      if (Number.isNaN(timestampMs)) return;
      pendingRequests.set(getRpcCorrelationKey(entry, entry.direction, rpcId), {
        method,
        timestampMs,
      });
      return;
    }

    const outcome = getRpcResponseOutcome(message);
    if (!outcome) return;

    const requestDirection = entry.direction === "send" ? "receive" : "send";
    const requestKey = getRpcCorrelationKey(entry, requestDirection, rpcId);
    const request = pendingRequests.get(requestKey);
    if (!request) return;
    pendingRequests.delete(requestKey);

    const responseTimestampMs = Date.parse(entry.timestamp);
    const latencyMs = responseTimestampMs - request.timestampMs;
    if (Number.isNaN(responseTimestampMs) || latencyMs < 0) return;

    responseLabels.set(entry.id, {
      method: request.method,
      latencyMs,
      outcome,
    });
  });

  return responseLabels;
}

function getRpcRequestId(id: unknown): RpcRequestId | null {
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function getRpcResponseOutcome(message: {
  result?: unknown;
  error?: unknown;
}): "result" | "error" | null {
  if (message.error !== undefined) return "error";
  if (message.result !== undefined) return "result";
  return null;
}

function getRpcCorrelationKey(
  entry: RpcTrafficEntry,
  direction: RpcTrafficEntry["direction"],
  rpcId: RpcRequestId
): string {
  return JSON.stringify([
    entry.source,
    entry.serverId,
    entry.widgetId ?? null,
    direction,
    typeof rpcId,
    rpcId,
  ]);
}
