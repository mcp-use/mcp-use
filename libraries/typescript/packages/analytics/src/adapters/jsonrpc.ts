/**
 * Reading JSON-RPC traffic at the HTTP layer, for adapters whose framework
 * does not expose every request to a handler wrapper (mcp-use v2 hooks six
 * methods). The response is read from a clone in the background, so the
 * client's copy is never delayed.
 */

import type { JsonRpcResponseMessage } from "../record.js";

/** A JSON-RPC request (has a method and an id). */
export interface JsonRpcRequestMessage {
  jsonrpc?: unknown;
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** Responses are read at most this far before giving up. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON-RPC requests (not notifications or responses) in a parsed body. */
export function requestMessages(body: unknown): JsonRpcRequestMessage[] {
  const items = Array.isArray(body) ? body : [body];
  const out: JsonRpcRequestMessage[] = [];
  for (const item of items) {
    if (
      isRecord(item) &&
      typeof item["method"] === "string" &&
      (typeof item["id"] === "string" || typeof item["id"] === "number")
    ) {
      out.push(item as unknown as JsonRpcRequestMessage);
    }
  }
  return out;
}

function responseMessages(
  value: unknown
): Array<{ id: unknown } & JsonRpcResponseMessage> {
  const items = Array.isArray(value) ? value : [value];
  return items.filter(
    (item): item is { id: unknown } & JsonRpcResponseMessage =>
      isRecord(item) && "id" in item && ("result" in item || "error" in item)
  );
}

/**
 * Read JSON-RPC responses from a (cloned) HTTP response, JSON or SSE, calling
 * `onMessage` for each. Stops once `done()` is true, at the size cap, or at
 * the end of the stream, and cancels the rest.
 */
export async function readResponses(
  response: Response,
  onMessage: (message: { id: unknown } & JsonRpcResponseMessage) => void,
  done: () => boolean
): Promise<void> {
  const body = response.body;
  if (body === null) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = (response.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("text/event-stream");
  let buffer = "";
  let bytes = 0;
  let data: string[] = [];

  const dispatchEvent = (): void => {
    if (data.length === 0) return;
    const payload = data.join("\n");
    data = [];
    try {
      for (const message of responseMessages(JSON.parse(payload)))
        onMessage(message);
    } catch {
      // Not JSON (keep-alive comments, priming events).
    }
  };

  const consumeLines = (final: boolean): void => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) break;
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") dispatchEvent();
      else if (line.startsWith("data:"))
        data.push(line.slice(5).replace(/^ /, ""));
    }
    if (final) {
      if (buffer.startsWith("data:"))
        data.push(buffer.slice(5).replace(/^ /, ""));
      buffer = "";
      dispatchEvent();
    }
  };

  try {
    for (;;) {
      if (done()) return;
      const { done: ended, value } = await reader.read();
      if (ended) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return;
      buffer += decoder.decode(value, { stream: true });
      if (sse) consumeLines(false);
    }
    buffer += decoder.decode();
    if (sse) {
      consumeLines(true);
    } else if (buffer.trim().length > 0) {
      try {
        for (const message of responseMessages(JSON.parse(buffer)))
          onMessage(message);
      } catch {
        // Not a JSON-RPC body.
      }
    }
  } catch {
    // The client went away or the stream failed; nothing more to read.
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
