import type { McpServer } from "@mcp-use/client/react";

/** Tooltip shown when the connected server does not advertise MCP Events. */
export const EVENTS_UNSUPPORTED_MESSAGE =
  "This server does not support MCP Events.";

/** SEP-2243 extension id under which servers may advertise MCP Events. */
export const EVENTS_EXTENSION_ID = "io.modelcontextprotocol/events";

/**
 * Whether the server advertises MCP Events, either as `capabilities.events`
 * or as `capabilities.extensions["io.modelcontextprotocol/events"]` (SEP-only
 * servers such as FastMCP).
 */
export function supportsEvents(server: McpServer | undefined): boolean {
  const caps = server?.capabilities as Record<string, unknown> | undefined;
  if (!caps) return false;
  if (caps.events !== undefined) return true;
  const ext = caps.extensions;
  return (
    ext !== null &&
    typeof ext === "object" &&
    (ext as Record<string, unknown>)[EVENTS_EXTENSION_ID] !== undefined
  );
}
