/**
 * Inspector Mounting
 *
 * Handles mounting of the MCP Inspector UI at /inspector endpoint.
 */

import type { Hono as HonoType } from "hono";
import { readBuildManifest } from "../widgets/index.js";

/**
 * Mount MCP Inspector UI at /inspector
 *
 * Dynamically loads and mounts the MCP Inspector UI package if available, providing
 * a web-based interface for testing and debugging MCP servers. The inspector
 * automatically connects to the local MCP server endpoints.
 *
 * This function gracefully handles cases where the inspector package is not installed,
 * allowing the server to function without the inspector in production environments.
 *
 * @param app - Hono app instance
 * @param serverHost - Server hostname
 * @param serverPort - Server port
 * @param isProduction - Whether the server is running in production mode
 * @returns Promise that resolves to true if inspector was mounted, false otherwise
 *
 * @example
 * If @mcp-use/inspector is installed:
 * - Inspector UI available at http://localhost:PORT/inspector
 * - Automatically connects to http://localhost:PORT/mcp (or /sse)
 *
 * If not installed:
 * - Server continues to function normally
 * - No inspector UI available
 */
export async function mountInspectorUI(
  app: HonoType,
  serverHost: string,
  serverPort: number | undefined,
  isProduction: boolean
): Promise<boolean> {
  // In production, only mount if build manifest says so
  if (isProduction) {
    const manifest = await readBuildManifest();
    if (!manifest?.includeInspector) {
      console.log(
        "[INSPECTOR] Skipped in production (use --with-inspector flag during build)"
      );
      return false;
    }
  }

  // Try to dynamically import the inspector package
  // Using dynamic import makes it truly optional - won't fail if not installed

  try {
    // @ts-ignore - Optional peer dependency, may not be installed during build
    const { mountInspector } = await import("@mcp-use/inspector");
    // Auto-connect to the local MCP server at /mcp (SSE endpoint)
    // Use JSON config to specify SSE transport type
    const mcpUrl = `http://${serverHost}:${serverPort}/mcp`; // Also available at /sse
    const autoConnectConfig = JSON.stringify({
      url: mcpUrl,
      name: "Local MCP Server",
      transportType: "sse",
      connectionType: "Direct",
    });
    mountInspector(app, { autoConnectUrl: autoConnectConfig });
    console.log(
      `[INSPECTOR] UI available at http://${serverHost}:${serverPort}/inspector`
    );
    return true;
  } catch {
    // Inspector package not installed, skip mounting silently
    // This allows the server to work without the inspector in production
    return false;
  }
}
