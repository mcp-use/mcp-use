/**
 * `@mcp-use/client` — MCP client for connecting to Model Context Protocol servers.
 *
 * Connectors, protocol-neutral MCP connections, project configuration, OAuth,
 * and code-mode helpers. The SDK negotiates legacy sessionful and modern
 * sessionless MCP servers automatically.
 */

import "./telemetry/configure-node.js";

export { auth, UnauthorizedError } from "@modelcontextprotocol/client";
export {
  completeOAuthFlow,
  isOAuthInteractionRequired,
  isUnauthorized,
} from "./auth/flow.js";
export {
  createOAuthProvider,
  NodeOAuthClientProvider,
  OAuthFlowError,
  type NodeOAuthAuthorizationResponse,
  type NodeOAuthOptions,
  type OAuthProviderOptions,
} from "./auth/node.js";
export { FileKVStore } from "./auth/storage-file.js";
export * from "./core/config.js";
export * from "./core/node.js";
export * from "./core/session.js";
export * from "./adapters/ai-sdk.js";

// Connectors
export * from "./transport/base.js";
export * from "./transport/http.js";
export * from "./transport/stdio.js";

// JSON Schema validation
export * from "./utils/json-schema-validator.js";

// Code mode (executors re-exported from core/node)
export * from "./code-mode/connector.js";

// Logging + internal telemetry
export {
  setTelemetrySource,
  setProductVersion,
  Tel,
  Telemetry,
  telFetch,
  capturePostHog,
  POSTHOG_HOST,
  POSTHOG_API_KEY,
} from "./telemetry/index.js";
export { logger } from "./utils/logging.js";

// Jev integrations are server-side only; credentials must not enter browser bundles.
export { JevError, type JevOptions } from "./jev/service.js";
export { JevRoutingError } from "./jev/router.js";
export { MCPFirewallError, type JevFirewallOptions } from "./jev/firewall.js";
