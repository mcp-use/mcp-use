/**
 * Server-entry discovery for `mcp-use build` and `mcp-use dev`.
 *
 * The entry contract (CLI_SPEC.md): the user's entry module default-exports
 * the `MCPServer` instance and never calls `listen()` itself — the CLI owns
 * the socket.
 */

import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Conventional entry locations, checked in order relative to the project
 * root; the first existing file wins.
 *
 * @internal
 */
export const ENTRY_CANDIDATES = [
  "src/index.ts",
  "src/server.ts",
  "index.ts",
  "server.ts",
] as const;

/**
 * Locate the server entry for a project.
 *
 * With `override` set (the `--entry` flag), the path is resolved against
 * `cwd` and must exist. Otherwise the {@link ENTRY_CANDIDATES} are probed in
 * order and the first hit wins.
 *
 * @param cwd - Absolute path to the project root.
 * @param override - Explicit entry path (`--entry`), absolute or relative to `cwd`.
 * @returns Absolute path to the entry file.
 * @throws If the override does not exist, or no conventional candidate is
 * found — the error lists every location that was checked.
 *
 * @internal
 */
export function discoverEntry(cwd: string, override?: string): string {
  if (override !== undefined) {
    const entry = isAbsolute(override) ? override : resolve(cwd, override);
    if (!existsSync(entry)) {
      throw new Error(
        `Entry not found: ${entry} (from --entry "${override}")`
      );
    }
    return entry;
  }
  for (const candidate of ENTRY_CANDIDATES) {
    const entry = join(cwd, candidate);
    if (existsSync(entry)) {
      return entry;
    }
  }
  throw new Error(
    `No server entry found in ${cwd}. Looked for: ` +
      `${ENTRY_CANDIDATES.join(", ")}. ` +
      `Create one of these (default-exporting your MCPServer instance) ` +
      `or pass --entry <path>.`
  );
}
