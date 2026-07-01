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
 * @param basePath - Normalized server-wide path prefix (see
 *   `config/base-path.ts`). The inspector mounts at `${basePath}/inspector`
 *   and auto-connects to the transport at `${basePath}`. Defaults to `/mcp`.
 * @returns Promise that resolves to true if inspector was mounted, false otherwise
 *
 * @example
 * If @mcp-use/inspector is installed:
 * - Inspector UI available at http://localhost:PORT/mcp/inspector
 * - Automatically connects to http://localhost:PORT/mcp (or /mcp/sse)
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
  basePath: string = "/mcp"
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
    // Auto-connect to the local MCP transport (now under basePath) via
    // streamable HTTP. When root-mounted (basePath ""), the transport is at "/".
    const transportPath = basePath === "" ? "/" : basePath;
    const mcpUrl = `http://${hostForBrowser}:${serverPort}${transportPath}`;
    const autoConnectConfig = JSON.stringify({
      url: mcpUrl,
      name: "Local MCP Server",
      transportType: "http",
      connectionType: "Direct",
    });
    mountInspector(app, {
      autoConnectUrl: autoConnectConfig,
      // In dev mode, tell the inspector to use same-origin for MCP Apps sandbox.
      // This avoids requiring a sandbox-{hostname} subdomain that doesn't exist
      // behind reverse proxies (ngrok, E2B, etc.)
      devMode: !isProduction,
      serverPort: typeof serverPort === "number" ? serverPort : undefined,
      // Relocate the inspector under the server-wide basePath so the whole
      // framework surface (transport, assets, inspector) shares one prefix.
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
