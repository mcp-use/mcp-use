import type { TanStackStartBuild } from "./types.js";

/** Fallback when the Start Vite plugin has not supplied build data. @internal */
export async function loadTanStackStartBuild(): Promise<TanStackStartBuild> {
  throw new Error(
    "No TanStack Start MCP build is available. Add mcpUseTanStackStart() " +
      "from mcp-use/tanstack-start/vite to vite.config.ts."
  );
}
