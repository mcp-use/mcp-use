/**
 * Distributed SSE stream routing helpers for stateful MCP sessions.
 *
 * Wraps SDK transports so standalone SSE messages can be delivered via
 * StreamManager when the local transport does not hold the SSE stream.
 */

import type { StreamManager } from "../sessions/index.js";
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
} from "../utils/jsonrpc-helpers.js";

type TransportSendOptions = {
  relatedRequestId?: string | number | null;
  [key: string]: unknown;
};

export type StreamableTransportWithSdkInternals = {
  send(message: unknown, options?: TransportSendOptions): Promise<void> | void;
  handleRequest(request: Request): Promise<Response>;
  close(): Promise<void> | void;
  _initialized?: boolean;
  sessionId?: string;
  onmessage?: (message: unknown) => void;
  _standaloneSseStreamId?: string;
  _streamMapping?: Map<
    string,
    { controller?: ReadableStreamDefaultController }
  >;
};

/**
 * Wrap a transport's send() method so that standalone SSE messages (notifications,
 * server-to-client requests) are routed through the StreamManager when the local
 * transport does not hold the SSE stream. Also registers outbound server-to-client
 * requests for distributed response correlation.
 */
export function wrapTransportForStreamManager(
  transport: StreamableTransportWithSdkInternals,
  sessionId: string,
  streamManager: StreamManager
): void {
  const originalSend = transport.send.bind(transport);
  transport.send = async (message: unknown, options?: TransportSendOptions) => {
    await originalSend(message, options);

    // Replicate the SDK's requestId resolution so we can tell standalone-SSE
    // messages apart from request-specific (POST response) messages.
    let requestId = options?.relatedRequestId;
    if (isJsonRpcResponse(message)) {
      requestId = message.id;
    }

    if (requestId !== undefined) return; // POST-response stream — SDK handled it

    const sseStreamId = transport._standaloneSseStreamId || "_GET_stream";
    const hasLocalStream = transport._streamMapping?.has(sseStreamId);

    if (!hasLocalStream) {
      // SDK stored the event for replay but could not deliver — route via StreamManager
      const sseData = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
      try {
        await streamManager.send([sessionId], sseData);
      } catch (err) {
        console.warn(
          `[MCP] StreamManager send failed for session ${sessionId}:`,
          err
        );
      }
    }

    // For server-to-client requests (sampling, elicitation, roots), register
    // the outbound request so responses can be routed back to this server.
    if (isJsonRpcRequest(message) && streamManager.registerOutboundRequest) {
      try {
        await streamManager.registerOutboundRequest(message.id, sessionId);
      } catch (err) {
        console.warn(`[MCP] Failed to register outbound request:`, err);
      }
    }
  };
}

/**
 * After a GET request creates a standalone SSE stream inside the SDK transport,
 * extract the controller and register it with the StreamManager so cross-server
 * messages can be delivered.
 */
export async function registerSseStream(
  transport: StreamableTransportWithSdkInternals,
  sessionId: string,
  streamManager: StreamManager
): Promise<void> {
  const sseStreamId = transport._standaloneSseStreamId || "_GET_stream";
  const streamEntry = transport._streamMapping?.get(sseStreamId);
  if (streamEntry?.controller) {
    try {
      await streamManager.create(sessionId, streamEntry.controller);
    } catch (err) {
      console.warn(
        `[MCP] Failed to register SSE stream with StreamManager:`,
        err
      );
    }
  }
}

/**
 * For POST requests that may contain JSON-RPC responses to server-to-client
 * requests (sampling, elicitation, roots), check if they need to be forwarded
 * to another server instance via the StreamManager.
 *
 * Clones the request so the original body remains readable for the SDK transport.
 */
export async function maybeForwardResponses(
  request: Request,
  sessionId: string,
  streamManager: StreamManager
): Promise<void> {
  if (!streamManager.forwardInboundResponse) return;
  try {
    const cloned = request.clone();
    const body = await cloned.json();
    const messages = Array.isArray(body) ? body : [body];
    for (const msg of messages) {
      if (isJsonRpcResponse(msg) && msg.id !== null) {
        await streamManager.forwardInboundResponse(
          { ...msg, id: msg.id },
          sessionId
        );
      }
    }
  } catch {
    // Not JSON or parsing error — not all POSTs carry routable responses
  }
}
