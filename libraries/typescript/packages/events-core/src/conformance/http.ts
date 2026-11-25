/**
 * Raw JSON-RPC over HTTP for the conformance runner: request envelopes for
 * both protocol eras, JSON and SSE response parsing. Builds every body itself
 * so results never depend on an SDK version (D27).
 *
 * @packageDocumentation
 */

/** A JSON-RPC message as received. */
export interface RpcMessage {
  /** Always `"2.0"`. */
  jsonrpc?: string;
  /** Request or response id. */
  id?: string | number | null;
  /** Notification or request method. */
  method?: string;
  /** Notification params. */
  params?: Record<string, unknown>;
  /** Success result. */
  result?: Record<string, unknown>;
  /** Error object. */
  error?: { code: number; message: string; data?: unknown };
}

/** The outcome of one request/response exchange. */
export interface RpcExchange {
  /** HTTP status. */
  status: number;
  /** Response headers. */
  headers: Headers;
  /** The response matching the request id, when one arrived. */
  response?: RpcMessage;
  /** Every message in the body, in order. */
  messages: RpcMessage[];
  /** The raw body when it was not JSON-RPC. */
  text?: string;
}

function isRpc(v: unknown): v is RpcMessage {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parses an SSE byte stream into JSON-RPC messages; comments and non-JSON data
 * frames are ignored.
 */
export async function* sseMessages(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<RpcMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data === "") continue;
        try {
          const parsed: unknown = JSON.parse(data);
          if (isRpc(parsed)) yield parsed;
        } catch {
          // not JSON: ignored
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Reads a whole response as JSON-RPC: `application/json` (single or batch) or
 * `text/event-stream`, stopping at the message whose id is `id`.
 */
export async function readExchange(
  res: Response,
  id: string | number
): Promise<RpcExchange> {
  const type = res.headers.get("content-type") ?? "";
  const out: RpcExchange = {
    status: res.status,
    headers: res.headers,
    messages: [],
  };
  if (type.includes("text/event-stream") && res.body) {
    for await (const m of sseMessages(res.body)) {
      out.messages.push(m);
      if (m.id === id && (m.result !== undefined || m.error !== undefined)) {
        out.response = m;
        break;
      }
    }
    return out;
  }
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const m of list) if (isRpc(m)) out.messages.push(m);
    const response =
      out.messages.find((m) => m.id === id) ??
      out.messages.find((m) => m.error !== undefined);
    if (response) out.response = response;
  } catch {
    out.text = text;
  }
  return out;
}

/** Describes an exchange for a failure detail. */
export function describe(x: RpcExchange): string {
  if (x.response?.error) {
    return `HTTP ${x.status}, error ${x.response.error.code} ${x.response.error.message}`;
  }
  if (x.response?.result) return `HTTP ${x.status}, result`;
  return `HTTP ${x.status}${x.text ? `, body ${x.text.slice(0, 120)}` : ""}`;
}
