import type { MCPServer } from "../server.js";

/** HTTP handler mounted by a TanStack Start server route. */
export type TanStackStartHandler = (request: Request) => Promise<Response>;

/**
 * Mount an authored MCP server inside TanStack Start.
 *
 * Pair with `mcpUseTanStackStart` from `mcp-use/tanstack-start/vite`.
 * Views, public assets and skills are loaded lazily from the bundled build.
 * The original request, response stream and server middleware are preserved.
 * Configure CORS on the MCPServer and forward OAuth discovery routes to this
 * same handler when using OAuth. Start owns the listener; do not call listen.
 *
 * @param server - Default-exported server used by the Vite plugin's entry.
 * @returns Fetch handler for the MCP endpoint and its nested asset routes.
 *
 * @example
 * ```ts
 * const handler = createTanStackStartHandler(server);
 * export const Route = createFileRoute("/api/mcp/$")({
 *   server: { handlers: { ANY: ({ request }) => handler(request) } },
 * });
 * ```
 */
export function createTanStackStartHandler<TUser>(
  server: MCPServer<TUser>
): TanStackStartHandler {
  let initialization: Promise<void> | undefined;
  const initialize = async (): Promise<void> => {
    const { loadTanStackStartBuild } =
      await import("#mcp-use-tanstack-start-build");
    const build = await loadTanStackStartBuild();
    if (server.basePath !== build.basePath) {
      throw new Error(
        `TanStack Start MCP basePath mismatch: server uses ${server.basePath}, ` +
          `but mcpUseTanStackStart uses ${build.basePath}.`
      );
    }
    server.__primeViews(build.views, { assets: build.assets });
    server.__primeSkills(build.skills);
  };
  return async (request) => {
    initialization ??= initialize();
    await initialization;
    return server.fetch(request);
  };
}
