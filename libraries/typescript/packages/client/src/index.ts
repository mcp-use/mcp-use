/**
 * @mcp-use/client — MCP client for connecting to Model Context Protocol servers.
 *
 * Connectors, protocol-neutral MCP connections, project configuration, OAuth,
 * and code-mode helpers. The SDK negotiates legacy sessionful and modern
 * sessionless MCP servers automatically.
 */

import "./telemetry/configure-node.js";

export {
  createOAuthProvider,
  type OAuthProviderOptions,
} from "./auth/node.js";
export {
  NodeOAuthClientProvider,
  OAuthFlowError,
  type NodeOAuthOptions,
} from "./auth/node.js";
export { completeOAuthFlow, isUnauthorized } from "./auth/flow.js";
export { FileKVStore } from "./auth/storage-file.js";
export { auth, UnauthorizedError } from "@modelcontextprotocol/client";
export * from "./core/node.js";
export * from "./core/session.js";
export * from "./core/config.js";

// Connectors
export * from "./transport/base.js";
export * from "./transport/http.js";
export * from "./transport/stdio.js";

// JSON Schema validation
export * from "./utils/json-schema-validator.js";

// Code mode (executors re-exported from core/node)
export * from "./code-mode/connector.js";

// Logging + internal telemetry
export { logger } from "./utils/logging.js";
export {
  Tel,
  Telemetry,
  setTelemetrySource,
  telFetch,
} from "./telemetry/index.js";
