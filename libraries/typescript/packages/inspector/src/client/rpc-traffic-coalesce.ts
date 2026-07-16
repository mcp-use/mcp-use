import type { RpcTrafficEntry, RpcTrafficInput } from "./rpc-traffic-store";

/** ponytail: fixed window; raise if resize bursts still feel noisy. */
const RPC_COALESCE_WINDOW_MS = 300;

const COALESCE_METHOD =
  /(?:^|\/)notifications\//;

export function getRpcTrafficMethod(message: unknown): string | null {
  const record = message as { method?: unknown };
  return typeof record?.method === "string" ? record.method : null;
}

/** Returns a stable merge key for bursty notification traffic, or null to always append. */
export function getRpcCoalesceKey(entry: RpcTrafficInput): string | null {
  const message = entry.message as {
    method?: unknown;
    id?: unknown;
    result?: unknown;
    error?: unknown;
  };

  if (message?.id !== undefined && message.id !== null) return null;
  if (message?.result !== undefined || message?.error !== undefined) return null;

  const method = getRpcTrafficMethod(entry.message);
  if (!method || !COALESCE_METHOD.test(method)) return null;

  return [
    entry.source,
    entry.serverId,
    entry.widgetId ?? "",
    entry.direction,
    method,
  ].join("|");
}

export function shouldCoalesceWithLast(
  last: RpcTrafficEntry,
  next: RpcTrafficInput,
  nowMs = Date.now()
): boolean {
  const lastKey = getRpcCoalesceKey(last);
  const nextKey = getRpcCoalesceKey(next);
  if (!lastKey || lastKey !== nextKey) return false;

  const lastMs = Date.parse(last.timestamp);
  if (Number.isNaN(lastMs)) return false;
  return nowMs - lastMs <= RPC_COALESCE_WINDOW_MS;
}

export function mergeRpcTrafficEntry(
  last: RpcTrafficEntry,
  next: RpcTrafficInput
): RpcTrafficEntry {
  return {
    ...last,
    timestamp: next.timestamp,
    message: next.message,
    repeatCount: (last.repeatCount ?? 1) + 1,
  };
}
