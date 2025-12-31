import { rpcLogBus, type RpcLogEvent } from "../server/rpc-log-bus.js";
import { getApiUrl } from "./utils/api.js";

// Browser-side RPC log bus that sends events to server
// This is a thin wrapper that publishes to the shared log bus
// and also sends events to the server via fetch
export const browserRpcLogBus = {
  publish: async (event: RpcLogEvent): Promise<void> => {
    console.log("[RPC Log Bus Browser] Publishing event:", {
      serverId: event.serverId,
      direction: event.direction,
      method: (event.message as any)?.method || "unknown",
    });

    // Publish to local bus (for immediate UI updates)
    try {
      rpcLogBus.publish(event);
      console.log("[RPC Log Bus Browser] Published to local bus");
    } catch (e) {
      console.error("[RPC Log Bus Browser] Failed to publish to local bus:", e);
    }

    // Also send to server for SSE streaming
    try {
      console.log("[RPC Log Bus Browser] Sending to server...");
      const response = await fetch(getApiUrl("/inspector/api/rpc/log"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        console.warn(
          "[RPC Log Bus Browser] Server returned non-OK status:",
          response.status
        );
      } else {
        console.log("[RPC Log Bus Browser] Sent to server successfully");
      }
    } catch (err) {
      console.warn(
        "[RPC Log Bus Browser] Failed to send event to server:",
        err
      );
    }
  },
  subscribe: rpcLogBus.subscribe.bind(rpcLogBus),
  getBuffer: rpcLogBus.getBuffer.bind(rpcLogBus),
  clear: rpcLogBus.clear.bind(rpcLogBus),
};
