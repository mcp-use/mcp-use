/**
 * Public entry point for the `mcp-use.config.json` project config, exposed via the
 * `mcp-use/config` subpath.
 *
 * Phase 1 (MCP-2613): types, schema, and a zero-execution loader only. No CLI
 * or server runtime consumes this yet.
 */

export {
  CONFIG_FILE_NAME,
  CONFIG_SCHEMA_URL,
  configSchema,
  DEFAULT_OUT_DIR,
  type McpUseConfig,
  type ResolvedConfig,
} from "./schema.js";

export {
  ConfigError,
  loadConfig,
  type LoadConfigOptions,
  type LoadConfigResult,
} from "./loader.js";

export {
  BUILD_MANIFEST_NAME,
  resolveWorkspace,
  resolveWorkspacePaths,
  type ResolvedWorkspace,
  type WorkspacePaths,
  WORKSPACE_DIR_NAME,
} from "./paths.js";

export {
  DEFAULT_BASE_PATH,
  normalizeBasePath,
  publicAssetBase,
  widgetAssetBase,
} from "./base-path.js";
