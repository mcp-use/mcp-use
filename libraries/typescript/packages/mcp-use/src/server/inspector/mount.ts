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
  isProduction: boolean,
  basePath: string = ""
): Promise<boolean> {
  // In production, only mount if build manifest says so
  if (isProduction) {
    const manifest = await readBuildManifest();
    if (!manifest?.includeInspector) {
      console.log(
        "[INSPECTOR] Skipped in production. To enable, rebuild with: mcp-use build --with-inspector"
      );
      return false;
    }
  }

  // Try to dynamically import the inspector package
  // Using dynamic import makes it truly optional - won't fail if not installed

  try {
    // @ts-ignore - Optional peer dependency, may not be installed during build
    const { mountInspector } = await import("@mcp-use/inspector");
    // 0.0.0.0 is valid for binding but browsers can't resolve it as a
    // destination, and the SDK's OAuth resource validator does strict
    // origin equality — so an autoConnect URL of http://0.0.0.0:PORT/mcp
    // mismatches the resource metadata published as http://localhost:PORT
    // (which goes through `normalizeUrlHost` in server-helpers.ts).
    const hostForBrowser =
      serverHost === "0.0.0.0" || serverHost === "::"
        ? "localhost"
        : serverHost;
    // Auto-connect to the local MCP server. The transport lives at
    // `${basePath}/mcp` externally; the inspector's auto-connect URL uses
    // the externally-visible path because it's loaded by the user's
    // browser, not internally.
    const mcpUrl = `http://${hostForBrowser}:${serverPort}${basePath}/mcp`;
    const autoConnectConfig = JSON.stringify({
      url: mcpUrl,
      name: "Local MCP Server",
      transportType: "sse",
      connectionType: "Direct",
    });
    // The inspector registers bare `/inspector/*` routes on whatever app
    // we hand it. We're handing it the inner app, which is already
    // sub-mounted under `basePath` by the MCPServer constructor — so the
    // inspector composes to `${basePath}/inspector/*` externally without
    // any wrapping here. `basePath` still flows in for URL emission
    // (`<base href>`, `window.__MCP_BASE_PATH__`).
    mountInspector(app, {
      autoConnectUrl: autoConnectConfig,
      // In dev mode, tell the inspector to use same-origin for MCP Apps sandbox.
      // This avoids requiring a sandbox-{hostname} subdomain that doesn't exist
      // behind reverse proxies (ngrok, E2B, etc.)
      devMode: !isProduction,
      serverPort: typeof serverPort === "number" ? serverPort : undefined,
      basePath,
    });
    console.log(
      `[INSPECTOR] UI available at http://${hostForBrowser}:${serverPort}${basePath}/inspector`
    );
    return true;
  } catch (err) {
    if (!isProduction || process.env.MCP_USE_DEBUG) {
      console.warn(
        "[INSPECTOR] Could not mount inspector UI:",
        err instanceof Error ? err.message : err
      );
    }
    return false;
  }
}
