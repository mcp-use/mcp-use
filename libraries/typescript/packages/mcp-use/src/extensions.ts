/**
 * Helpers for advertising SEP-1724 extension capabilities during the MCP
 * `initialize` handshake.
 *
 * Extensions are namespaced add-ons to the core MCP capability set. They live
 * under `capabilities.extensions[<extension-id>]` and are strictly additive:
 * a client/server that does not recognise an extension MUST ignore it.
 *
 * @see https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1724
 */

/**
 * Identifier for the MCP Apps extension (SEP-1865).
 */
export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";

/**
 * Canonical MIME type for MCP Apps widget resources (SEP-1865).
 */
export const MCP_APPS_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Returns the `extensions` fragment that advertises support for the MCP Apps
 * extension (SEP-1865). Assign to `capabilities.extensions`, or spread when
 * combining with other extensions.
 *
 * @example
 * ```ts
 * import { MCPClient, mcpApps } from "mcp-use";
 *
 * const client = new MCPClient({
 *   capabilities: {
 *     extensions: mcpApps(), // advertise MCP Apps to every server
 *   },
 *   mcpServers: { widget: { url: "..." } },
 * });
 *
 * // Combining with other extensions:
 * new MCPClient({
 *   capabilities: {
 *     extensions: { ...mcpApps(), "com.example/custom": { setting: 1 } },
 *   },
 *   mcpServers: { ... },
 * });
 * ```
 */
export function mcpApps(): Record<string, { mimeTypes: string[] }> {
  return {
    [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APPS_MIME_TYPE] },
  };
}
