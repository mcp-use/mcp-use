import type { Transport } from "@mcp-use/modelcontextprotocol-sdk/shared/transport.js";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type { TransportSendOptions } from "@mcp-use/modelcontextprotocol-sdk/shared/transport.js";

export interface RpcLogEntry {
  serverId: string;
  direction: "send" | "receive";
  timestamp: string;
  message: JSONRPCMessage;
}

/**
 * Simple in-memory RPC log storage
 * Stores RPC messages for debugging purposes
 */
class RpcLogStore {
  private logs: RpcLogEntry[] = [];
  private listeners: Set<(entry: RpcLogEntry) => void> = new Set();
  private maxLogs = 1000;

  publish(entry: RpcLogEntry): void {
    console.log(
      "[RPC Logger] Publishing log:",
      entry.direction,
      entry.serverId,
      (entry.message as any)?.method
    );
    this.logs.push(entry);

    // Prune old logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    console.log(
      "[RPC Logger] Total logs:",
      this.logs.length,
      "Listeners:",
      this.listeners.size
    );

    // Notify listeners
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (err) {
        console.error("[RPC Logger] Listener error:", err);
      }
    });
  }

  subscribe(listener: (entry: RpcLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getLogsForServer(serverId: string): RpcLogEntry[] {
    return this.logs.filter((log) => log.serverId === serverId);
  }

  getAllLogs(): RpcLogEntry[] {
    return [...this.logs];
  }

  clear(serverId?: string): void {
    if (serverId) {
      this.logs = this.logs.filter((log) => log.serverId !== serverId);
    } else {
      this.logs = [];
    }
  }
}

// Global store instance
const rpcLogStore = new RpcLogStore();

/**
 * Get RPC logs for a specific server
 */
export function getRpcLogs(serverId: string): RpcLogEntry[] {
  return rpcLogStore.getLogsForServer(serverId);
}

/**
 * Get all RPC logs
 */
export function getAllRpcLogs(): RpcLogEntry[] {
  return rpcLogStore.getAllLogs();
}

/**
 * Subscribe to RPC log events
 */
export function subscribeToRpcLogs(
  listener: (entry: RpcLogEntry) => void
): () => void {
  return rpcLogStore.subscribe(listener);
}

/**
 * Clear RPC logs
 */
export function clearRpcLogs(serverId?: string): void {
  rpcLogStore.clear(serverId);
}

/**
 * Wrap a transport to log all RPC messages
 * @param transport - The transport to wrap
 * @param serverId - Server ID for log attribution
 * @returns Wrapped transport that logs all messages
 */
export function wrapTransportForLogging(
  transport: Transport,
  serverId: string
): Transport {
  console.log("[RPC Logger] Wrapping transport for server:", serverId);

  class LoggingTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;

    constructor(private readonly inner: Transport) {
      // Intercept incoming messages
      this.inner.onmessage = (
        message: JSONRPCMessage,
        extra?: MessageExtraInfo
      ) => {
        // Log RPC message
        rpcLogStore.publish({
          serverId,
          direction: "receive",
          timestamp: new Date().toISOString(),
          message,
        });
        this.onmessage?.(message, extra);
      };

      this.inner.onclose = () => {
        this.onclose?.();
      };

      this.inner.onerror = (error: Error) => {
        this.onerror?.(error);
      };
    }

    async start(): Promise<void> {
      if (typeof (this.inner as any).start === "function") {
        await (this.inner as any).start();
      }
    }

    async send(
      message: JSONRPCMessage,
      options?: TransportSendOptions
    ): Promise<void> {
      // Log RPC message
      rpcLogStore.publish({
        serverId,
        direction: "send",
        timestamp: new Date().toISOString(),
        message,
      });
      await this.inner.send(message as any, options as any);
    }

    async close(): Promise<void> {
      await this.inner.close();
    }

    get sessionId(): string | undefined {
      return (this.inner as any).sessionId;
    }

    setProtocolVersion?(version: string): void {
      if (typeof this.inner.setProtocolVersion === "function") {
        this.inner.setProtocolVersion(version);
      }
    }
  }

  return new LoggingTransport(transport);
}
