/**
 * Resolution of the user's project-level Vite config file, shared by
 * `mcp-use build` and `mcp-use dev` (CLI_SPEC.md § Commands).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/** Filenames probed, in order, for the user's project-level Vite config. */
const VITE_CONFIG_CANDIDATES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.cjs",
] as const;

/**
 * Locate the user's Vite config file in `cwd`, returning its absolute path —
 * or `false` when none exists, the value Vite's `configFile` option takes to
 * disable config-file loading.
 *
 * @param cwd - Absolute path to the project root.
 *
 * @internal
 */
export function resolveUserViteConfig(cwd: string): string | false {
  for (const name of VITE_CONFIG_CANDIDATES) {
    const path = join(cwd, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return false;
}
