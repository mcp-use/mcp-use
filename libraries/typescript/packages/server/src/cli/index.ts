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

export { runBuild } from "./build.js";
export { runDev } from "./dev.js";
export { discoverEntry, ENTRY_CANDIDATES } from "./entry.js";
export {
  BUILD_MANIFEST_NAME,
  WORKSPACE_DIR_NAME,
  type BuildManifest,
} from "./workspace.js";
