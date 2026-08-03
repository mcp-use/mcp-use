import {
  getAllRpcLogs,
  subscribeToRpcLogs,
  type RpcLogEntry,
} from "@mcp-use/client/react";
import { rpcTrafficStore } from "./rpc-traffic-store";

let unsubscribe: (() => void) | undefined;

function publishMcpLog(entry: RpcLogEntry): void {
  rpcTrafficStore.publish({
    source: "mcp",
    serverId: entry.serverId,
    direction: entry.direction,
    timestamp: entry.timestamp,
    message: entry.message,
  });
}

/** Connect the process-wide @mcp-use/client logger to the inspector store once. */
export function ensureRpcTrafficBridge(): void {
  if (unsubscribe) return;

  getAllRpcLogs().forEach(publishMcpLog);
  unsubscribe = subscribeToRpcLogs(publishMcpLog);
}
