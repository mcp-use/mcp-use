import type { Transport } from "@mcp-use/modelcontextprotocol-sdk/shared/transport.js";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type { TransportSendOptions } from "@mcp-use/modelcontextprotocol-sdk/shared/transport.js";
import { browserRpcLogBus } from "./rpc-log-bus-browser.js";

/**
 * Wrap a transport to log all RPC messages to the RPC log bus (browser version)
 */
export function wrapTransportForLogging(
  transport: Transport,
  serverId: string
): Transport {
  console.log("[RPC Logger] Wrapping transport for server:", serverId);
  // Wrapper that proxies to the underlying transport while emitting logs
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
        browserRpcLogBus
          .publish({
            serverId,
            direction: "receive",
            timestamp: new Date().toISOString(),
            message,
          })
          .catch((err) => {
            // Log error for debugging but don't break MCP functionality
            console.warn("[RPC Logger] Failed to publish receive event:", err);
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
      browserRpcLogBus
        .publish({
          serverId,
          direction: "send",
          timestamp: new Date().toISOString(),
          message,
        })
        .catch((err) => {
          // Log error for debugging but don't break MCP functionality
          console.warn("[RPC Logger] Failed to publish send event:", err);
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
