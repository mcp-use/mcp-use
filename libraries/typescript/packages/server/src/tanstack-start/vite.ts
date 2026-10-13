import { mcpUse, type McpUseOptions } from "../vite/index.js";
import type { PluginOption } from "vite";

/** Source and route options for TanStack React Start on Node. */
export interface TanStackStartOptions extends McpUseOptions {
  /**
   * Removed: configure React, CSS and aliases in the application Vite config.
   * @deprecated Separate view configurations are no longer supported.
   */
  viewsConfig?: string;
}

/**
 * Add a dedicated MCP environment and live view HMR to TanStack React Start.
 * Pair with createTanStackStartHandler() in a server route. Start owns the
 * listener; the authored entry must default-export an MCPServer without listen().
 * @param options - MCP source directories and endpoint.
 * @returns Plugins placed before TanStack Start, Nitro and React.
 */
export function mcpUseTanStackStart(
  options: TanStackStartOptions = {}
): PluginOption[] {
  if (options.viewsConfig !== undefined)
    throw new Error(
      "mcpUseTanStackStart viewsConfig was removed. Configure React, CSS and aliases in the application Vite config."
    );
  return mcpUse(options);
}
