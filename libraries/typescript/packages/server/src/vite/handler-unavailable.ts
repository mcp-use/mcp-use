/** Report a missing framework plugin without importing build tooling. @internal */
export function handleMcpRequest(_request: Request): Promise<Response> {
  throw new Error(
    "Add mcpUseTanStackStart() or mcpUse() to your Vite config before using the MCP handler."
  );
}
