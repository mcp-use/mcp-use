import type { McpServer } from "@mcp-use/client/react";

/** Reconstruct the MCP `initialize` result payload from normalized server state. */
export function buildInitializeResultPayload(
  connection: McpServer
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (connection.protocolVersion) {
    payload.protocolVersion = connection.protocolVersion;
  }
  if (connection.capabilities) {
    payload.capabilities = connection.capabilities;
  }
  if (connection.serverInfo) {
    const { icon: _icon, ...serverInfo } = connection.serverInfo;
    payload.serverInfo = serverInfo;
  }
  if (connection.instructions) {
    payload.instructions = connection.instructions;
  }

  return payload;
}
