import {
  CLIENT_CAPABILITIES_META_KEY,
  type ServerContext,
} from "@modelcontextprotocol/server";

import { supportsViews } from "./views/capabilities.js";

/**
 * Per-request client capability queries.
 *
 * Reads the modern per-request envelope only — never session state.
 */
export interface RequestClientContext {
  /**
   * Whether this request's client advertises MCP Apps / UI support.
   *
   * True when the client declares the `io.modelcontextprotocol/ui` extension
   * with `text/html;profile=mcp-app` in `mimeTypes`. Legacy (non-envelope)
   * requests always return `false`.
   */
  supportsViews(): boolean;
}

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
  /** Per-request client capability queries. */
  client: RequestClientContext;
}

/**
 * Derive the callback-facing {@link RequestContext} from the SDK's
 * per-request `ServerContext`.
 *
 * @internal
 */
export function toRequestContext(ctx: ServerContext): RequestContext {
  const request = ctx.http?.req;
  const envelopeCaps =
    ctx.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY];

  return {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
    client: {
      supportsViews(): boolean {
        return supportsViews(envelopeCaps);
      },
    },
  };
}
