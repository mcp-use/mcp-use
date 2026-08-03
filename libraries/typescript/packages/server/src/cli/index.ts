/**
 * The `mcp-use` dev/build toolchain, built on Vite.
 *
 * Shared source exports for CLI tests and internal tooling. The published bin
 * dispatches `dev` and `build` through separate `src/commands/*` entries so
 * neither command, production startup, nor library imports evaluate unrelated
 * Vite code.
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
