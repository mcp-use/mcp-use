/**
 * Public entry point for the `mcp-use.json` project config, exposed via the
 * `mcp-use/config` subpath.
 *
 * Phase 1 (MCP-2613): types, schema, and a zero-execution loader only. No CLI
 * or server runtime consumes this yet.
 */

export {
  CONFIG_FILE_NAME,
  CONFIG_SCHEMA_URL,
  configSchema,
  type McpUseConfig,
  type ResolvedConfig,
} from "./schema.js";

export {
  ConfigError,
  loadConfig,
  type LoadConfigOptions,
  type LoadConfigResult,
} from "./loader.js";
