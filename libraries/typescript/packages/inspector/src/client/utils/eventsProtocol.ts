import type { McpServer } from "@mcp-use/client/react";

/** Tooltip shown when the connected server does not advertise MCP Events. */
export const EVENTS_UNSUPPORTED_MESSAGE =
  "This server does not support MCP Events.";

/** Whether the server advertises MCP Events (`capabilities.events`). */
export function supportsEvents(server: McpServer | undefined): boolean {
  return server?.capabilities?.events !== undefined;
}
