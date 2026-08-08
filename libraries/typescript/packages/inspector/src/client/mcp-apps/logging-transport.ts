/**
 * Transport wrapper that publishes every JSON-RPC message to the RPC inspector.
 *
 * AppFrame owns PostMessageTransport construction; we subclass AppBridge and
 * wrap the transport in `connect()` so send/receive logging still works.
 */

import type { JSONRPCMessage, Transport } from "@mcp-use/client/react";
import { rpcTrafficStore } from "../rpc-traffic-store.js";

/**
 * Wrap a transport so every outbound `send` and inbound `onmessage` is logged
 * under its real MCP server and widget call IDs in the inspector traffic store.
 */
export function wrapTransportWithLogging(
  transport: Transport,
  serverId: string,
  toolCallId: string
): Transport {
  const wrapper: Transport = {
    get sessionId() {
      return transport.sessionId;
    },
    set sessionId(value: string | undefined) {
      transport.sessionId = value;
    },
    setProtocolVersion: transport.setProtocolVersion
      ? (version: string) => transport.setProtocolVersion?.(version)
      : undefined,
    async start() {
      return transport.start();
    },
    async send(message, options) {
      rpcTrafficStore.publish({
        source: "widget",
        serverId,
        widgetId: toolCallId,
        direction: "send",
        timestamp: new Date().toISOString(),
        message: message as JSONRPCMessage,
      });
      return transport.send(message, options);
    },
    async close() {
      return transport.close();
    },
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
  };

  // Forward Protocol-assigned callbacks onto the inner transport, logging receives.
  Object.defineProperty(wrapper, "onmessage", {
    configurable: true,
    enumerable: true,
    get() {
      return transport.onmessage;
    },
    set(handler: Transport["onmessage"]) {
      if (!handler) {
        transport.onmessage = undefined;
        return;
      }
      transport.onmessage = (message, extra) => {
        rpcTrafficStore.publish({
          source: "widget",
          serverId,
          widgetId: toolCallId,
          direction: "receive",
          timestamp: new Date().toISOString(),
          message: message as JSONRPCMessage,
        });
        handler(message, extra);
      };
    },
  });

  Object.defineProperty(wrapper, "onclose", {
    configurable: true,
    enumerable: true,
    get() {
      return transport.onclose;
    },
    set(handler: Transport["onclose"]) {
      transport.onclose = handler;
    },
  });

  Object.defineProperty(wrapper, "onerror", {
    configurable: true,
    enumerable: true,
    get() {
      return transport.onerror;
    },
    set(handler: Transport["onerror"]) {
      transport.onerror = handler;
    },
  });

  return wrapper;
}
