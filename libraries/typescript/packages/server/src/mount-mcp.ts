import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  type McpHttpHandler,
  type McpServerFactory,
} from "@modelcontextprotocol/server";
import type { Env, Hono } from "hono";

/** Options for {@link mountMcp}. */
export interface MountMcpOptions {
  /** Route path the MCP endpoint is served on. Defaults to `/mcp`. */
  path?: string;
  /**
   * Options forwarded to the SDK's `createMcpHandler`.
   *
   * `legacy` defaults to `"reject"`: this package supports only the
   * stateless 2026-07-28 protocol revision, so 2025-era requests are
   * refused with an unsupported-protocol-version error. Pass
   * `legacy: "stateless"` to also serve old-revision clients.
   */
  handler?: CreateMcpHandlerOptions;
}

/**
 * Mount a stateless MCP endpoint on a Hono app.
 *
 * The factory builds a fresh `McpServer` per HTTP request (the SDK holds
 * nothing between requests), so the mounted endpoint scales horizontally with
 * no session affinity.
 *
 * The returned handler is the SDK's `McpHttpHandler`; call `close()` on
 * shutdown to abort in-flight exchanges, and use `notify`/`bus` for
 * list-changed notifications.
 *
 * Prefer apps created with `createMcpHonoApp` (what `MCPServer` uses when
 * Host validation applies): it installs JSON body parsing and Host/Origin
 * validation (DNS-rebinding protection). On a bare Hono app this mount
 * performs no such validation itself — compose the
 * `@modelcontextprotocol/hono` middleware in front, only bind to localhost,
 * or serve behind a platform edge that routes by hostname.
 */
export function mountMcp<E extends Env>(
  app: Hono<E>,
  factory: McpServerFactory,
  options: MountMcpOptions = {}
): McpHttpHandler {
  const { path = "/mcp", handler: handlerOptions } = options;
  const handler = createMcpHandler(factory, {
    legacy: "reject",
    ...handlerOptions,
  });
  app.all(path, (c) => {
    // createMcpHonoApp's JSON middleware stashes the parsed body in context
    // vars (a request body is only readable once); on bare apps it is absent
    // and the SDK handler parses the body itself.
    const parsedBody = (c.var as Record<string, unknown>)["parsedBody"];
    return handler.fetch(
      c.req.raw,
      parsedBody === undefined ? undefined : { parsedBody }
    );
  });
  return handler;
}
