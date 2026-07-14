import {
  createMcpHandler,
  type AuthInfo,
  type CreateMcpHandlerOptions,
  type McpHttpHandler,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import type { Context, Env, Hono } from "hono";

import {
  extractClientCapabilitiesFromBody,
  stashClientCapabilities,
} from "./views/capabilities.js";

/** Options for {@link mountMcp}. */
export interface MountMcpOptions<E extends Env = Env> {
  /** Route path the MCP endpoint is served on. Defaults to `/mcp`. */
  path?: string;
  /**
   * Options forwarded to the SDK's `createMcpHandler`.
   *
   * `legacy` defaults to `"stateless"`: 2025-era (non-envelope) requests are
   * served by a fresh instance over a session-less streamable HTTP transport.
   * Pass `legacy: "reject"` for modern-only strict serving, where
   * legacy-classified requests get the unsupported-protocol-version error.
   */
  handler?: CreateMcpHandlerOptions;
  /** AuthInfo produced by host middleware and forwarded to the SDK request. */
  authInfo?: (context: Context<E>) => AuthInfo | undefined;
}

/**
 * Mount the MCP Streamable HTTP endpoint onto a Hono app.
 *
 * Returns the underlying `McpHttpHandler` so callers can call `close()` on
 * shutdown to abort in-flight exchanges, and use `notify`/`bus` for
 * list-changed notifications.
 *
 * Prefer apps wired like `MCPServer` (JSON body parsing stashed in context
 * vars plus Host/Origin validation when Host validation applies).
 * On a bare Hono app this mount performs no such validation itself — compose
 * the `@modelcontextprotocol/hono` middleware in front, only bind to
 * localhost, or serve behind a platform edge that routes by hostname.
 */
export function mountMcp<E extends Env>(
  app: Hono<E>,
  factory: McpServerFactory,
  options: MountMcpOptions<E> = {}
): McpHttpHandler {
  const { path = "/mcp", handler: handlerOptions, authInfo: getAuthInfo } =
    options;
  const handler = createMcpHandler(factory, {
    legacy: "stateless",
    ...handlerOptions,
  });
  app.all(path, async (c) => {
    // JSON body parsing middleware stashes the parsed body in context vars
    // (a request body is only readable once); on bare apps it is absent and
    // the SDK handler parses the body itself.
    let parsedBody = (c.var as Record<string, unknown>)["parsedBody"];
    if (parsedBody === undefined) {
      try {
        parsedBody = await c.req.raw.clone().json();
      } catch {
        // Non-JSON or empty body — the SDK handler will surface the error.
      }
    }
    const capabilities = extractClientCapabilitiesFromBody(parsedBody);
    if (capabilities !== undefined) {
      stashClientCapabilities(c.req.raw, capabilities);
    }
    const authInfo = getAuthInfo?.(c);
    return handler.fetch(c.req.raw, {
      ...(parsedBody !== undefined && { parsedBody }),
      ...(authInfo !== undefined && { authInfo }),
    });
  });
  return handler;
}
