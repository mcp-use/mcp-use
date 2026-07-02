import type { ServerContext } from "@modelcontextprotocol/server";

/**
 * Per-request context passed to tool/resource/prompt callbacks.
 *
 * Grows with later phases (auth, elicitation via input_required, progress);
 * everything here is stateless request-scoped data.
 */
export interface RequestContext {
  /** Aborted when the client cancels the request or the connection drops. */
  signal: AbortSignal;
  /** The originating HTTP request, when served over HTTP. */
  request?: Request;
}

/**
 * Derive the callback-facing {@link RequestContext} from the SDK's
 * per-request `ServerContext`.
 *
 * @internal
 */
export function toRequestContext(ctx: ServerContext): RequestContext {
  const request = ctx.http?.req;
  return {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
  };
}
