/**
 * Public entry point for project/workspace path + base-path helpers, exposed
 * via the `mcp-use/config` subpath.
 *
 * There is deliberately NO config file: project configuration lives on the
 * `MCPServer` constructor (`viewsDir`, `publicDir`, `basePath`,
 * `assetPrefix`, …) — tooling reads it by importing the server entry and
 * introspecting the instance — and the `.mcp-use/` workspace layout is a
 * fixed convention derived here.
 */

export {
  BUILD_MANIFEST_NAME,
  resolveWorkspacePaths,
  type WorkspacePaths,
  WORKSPACE_DIR_NAME,
} from "./paths.js";

export {
  DEFAULT_BASE_PATH,
  normalizeBasePath,
  publicAssetBase,
  widgetAssetBase,
} from "./base-path.js";
