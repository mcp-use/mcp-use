/**
 * Lazy `mcp-use start` command entry.
 *
 * @internal
 */
export type { StartOptions, StartedServer } from "../bin/start.js";

import type { StartOptions, StartedServer } from "../bin/start.js";

/**
 * Load the Node-only production start implementation on demand.
 *
 * @param options - Project root and listener preferences.
 * @returns A handle for the started server.
 * @internal
 */
export async function runStart(options: StartOptions): Promise<StartedServer> {
  const runtime = await import("../bin/start.js");
  return runtime.runStart(options);
}
