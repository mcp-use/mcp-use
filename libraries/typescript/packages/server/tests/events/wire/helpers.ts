import type { MCPServer } from "../../../src/index.js";

export const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "events-test",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** POST one JSON-RPC body to `server.fetch` and return status and JSON. */
export async function post(
  server: MCPServer,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: Headers; json: unknown }> {
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    })
  );
  return {
    status: response.status,
    headers: response.headers,
    json: await response.json(),
  };
}

/** A modern-era request with the protocol headers. */
export function modern(
  server: MCPServer,
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return post(
    server,
    {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: MODERN_META },
    },
    { "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...headers }
  );
}

/** A legacy-era request (no envelope). */
export function legacy(
  server: MCPServer,
  method: string,
  params: Record<string, unknown>
) {
  return post(server, { jsonrpc: "2.0", id: 1, method, params });
}
