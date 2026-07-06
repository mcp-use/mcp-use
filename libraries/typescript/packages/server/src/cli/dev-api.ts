/**
 * Dev-only inspector API routes intercepted by `mcp-use dev` before the MCP
 * handler — tunnel controls and session metadata for the inspector UI.
 */

import type { TunnelManager } from "./tunnel.js";

/** Web-standard request handler, as returned by `MCPServer.getHandler()`. */
type FetchHandler = (request: Request) => Promise<Response>;

/**
 * Dependencies for {@link createDevApiHandler}.
 *
 * @internal
 */
export interface DevApiHandlerOptions {
  /** Returns the current MCP mount path (may change after a dev reload). */
  getBasePath: () => string;
  /** Port the dev HTTP listener is bound to. */
  port: number;
  /** Tunnel lifecycle manager owned by the dev process. */
  tunnel: TunnelManager;
}

/** JSON body for `GET …/inspector/api/dev/info`. */
export interface DevInfoResponse {
  /** Full MCP endpoint URL when a tunnel is active; otherwise `null`. */
  mcpUrl: string | null;
  /** Port the dev server listens on. */
  port: number;
  /** Whether the request is served by `mcp-use dev` (always `true` here). */
  fromCli: true;
  /** Public tunnel origin URL, or `null` when no tunnel is running. */
  tunnelUrl: string | null;
}

/**
 * Wrap an MCP {@link FetchHandler} so dev-only inspector API routes are
 * answered in-process before delegating everything else.
 *
 * @param options - Base path, bound port, and tunnel manager.
 * @param fallback - Handler to invoke when the request is not a dev API route.
 *
 * @example
 * ```ts
 * const handler = createDevApiHandler(
 *   { getBasePath: () => "/mcp", port: 3000, tunnel },
 *   server.getHandler()
 * );
 * ```
 */
export function createDevApiHandler(
  options: DevApiHandlerOptions,
  fallback: FetchHandler
): FetchHandler {
  const devInfo = (): DevInfoResponse => {
    const basePath = options.getBasePath();
    const { url: tunnelUrl } = options.tunnel.status();
    return {
      mcpUrl:
        tunnelUrl !== null
          ? `${tunnelUrl.replace(/\/+$/, "")}${basePath}`
          : null,
      port: options.port,
      fromCli: true,
      tunnelUrl,
    };
  };

  return async (request: Request): Promise<Response> => {
    const basePath = options.getBasePath();
    const infoPath = `${basePath}/inspector/api/dev/info`;
    const startPath = `${basePath}/inspector/api/dev/start-tunnel`;
    const stopPath = `${basePath}/inspector/api/dev/stop-tunnel`;
    const pathname = new URL(request.url).pathname;

    if (request.method === "GET" && pathname === infoPath) {
      return Response.json(devInfo());
    }

    if (request.method === "POST" && pathname === startPath) {
      try {
        await options.tunnel.start(options.port);
        return Response.json({ ok: true, restarting: false });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to start tunnel";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    if (request.method === "POST" && pathname === stopPath) {
      await options.tunnel.stop();
      return Response.json({ ok: true });
    }

    return fallback(request);
  };
}
