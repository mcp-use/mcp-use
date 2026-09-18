/** HTTP handler mounted by a TanStack Start server route. */
export type TanStackStartHandler = (request: Request) => Promise<Response>;

/**
 * Forward requests to the MCP entry configured by mcpUseTanStackStart().
 *
 * Development requests reach the current instance in the dedicated MCP Vite
 * environment. Production loads the compiled entry and its bundled assets.
 * The adapter preserves streaming responses and request cancellation. Configure
 * CORS on MCPServer and forward OAuth discovery routes to this same handler.
 * Do not import the authored server into the Start route or call listen().
 *
 * @returns Fetch handler for the MCP endpoint and OAuth discovery routes.
 * @example
 * ```ts
 * const handler = createTanStackStartHandler();
 * export const Route = createFileRoute("/api/mcp/$")({
 *   server: { handlers: { ANY: ({ request }) => handler(request) } },
 * });
 * ```
 */
export function createTanStackStartHandler(): TanStackStartHandler {
  return async (request) => {
    const { handleMcpRequest } = await import("#mcp-use-vite-handler");
    return handleMcpRequest(request);
  };
}
