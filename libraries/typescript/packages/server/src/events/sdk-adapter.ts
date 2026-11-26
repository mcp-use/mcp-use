/**
 * SDK boundary for MCP Events. mcp-use answers every `events/*` request
 * itself, before the SDK handler sees it, so an SDK release that adds native
 * Events handlers cannot take these methods over.
 *
 * @internal
 */

/** A single JSON-RPC request whose method is `events/*`. */
interface EventsRequest {
  id: string | number;
  method: string;
  params: unknown;
}

/**
 * Recognise an `events/*` JSON-RPC request in a parsed body.
 *
 * @param body - The parsed request body.
 */
export function asEventsRequest(body: unknown): EventsRequest | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return;
  const b = body as Record<string, unknown>;
  if (
    b.jsonrpc !== "2.0" ||
    typeof b.method !== "string" ||
    !b.method.startsWith("events/") ||
    (typeof b.id !== "string" && typeof b.id !== "number")
  )
    return;
  return { id: b.id, method: b.method, params: b.params };
}

/**
 * Wrap a JSON-RPC result or error in an HTTP response.
 *
 * @param id - Request id.
 * @param outcome - `{ result }` or `{ error }`.
 */
export function rpcResponse(
  id: string | number,
  outcome: { result: unknown } | { error: unknown }
): Response {
  return Response.json({ jsonrpc: "2.0", id, ...outcome });
}

/** `_meta` key under which 2026-07-28 results carry the server identity. */
const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";

/**
 * Stamp a result the way the SDK's 2026-07-28 encode seam stamps every
 * custom-method result: `resultType: "complete"` (events results only support
 * `complete`) and the server identity under `_meta`. Values already present
 * are kept. Earlier-revision results are sent unstamped.
 *
 * @param result - The plain events result.
 * @param serverInfo - The server's `Implementation` identity.
 */
export function stampModernResult(
  result: unknown,
  serverInfo: object
): Record<string, unknown> {
  const r = { ...(result as Record<string, unknown>) };
  r.resultType ??= "complete";
  const meta = r._meta;
  if (meta === undefined) r._meta = { [SERVER_INFO_META_KEY]: serverInfo };
  else if (
    meta !== null &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    (meta as Record<string, unknown>)[SERVER_INFO_META_KEY] === undefined
  )
    r._meta = { ...meta, [SERVER_INFO_META_KEY]: serverInfo };
  return r;
}
