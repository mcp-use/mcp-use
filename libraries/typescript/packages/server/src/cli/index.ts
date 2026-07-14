/**
 * The `mcp-use` dev/build toolchain, built on Vite.
 *
 * Implements `mcp-use build` and `mcp-use dev`; `src/bin/main.ts` dispatches
 * to {@link runBuild} and {@link runDev} via a dynamic `import("./cli/index.js")`
 * so nothing on the `start`/library import path ever evaluates this module
 * (and therefore never evaluates Vite — see `specs/CLI_SPEC.md` § Package
 * layout & dependency rules). `vite` itself is an optional peer dependency:
 * it is imported lazily inside {@link runBuild}/{@link runDev} so a missing
 * install fails with an actionable hint instead of at module load time.
 *
 * @packageDocumentation
 */

export { runBuild, type BuildOptions } from "./build.js";
export { runDev, type DevOptions } from "./dev.js";
export { discoverEntry, ENTRY_CANDIDATES } from "./entry.js";
export { resolvePort, type ResolvedPort } from "./port.js";
export { discoverViews, type DiscoveredView } from "./views.js";
export {
  BUILD_MANIFEST_NAME,
  WORKSPACE_DIR_NAME,
  resolveWorkspacePaths,
  type BuildManifest,
  type WorkspacePaths,
} from "./workspace.js";
