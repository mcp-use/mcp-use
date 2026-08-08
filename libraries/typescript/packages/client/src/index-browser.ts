/**
 * Browser, worker, Bun, and Deno entry point for `@mcp-use/client`.
 *
 * This module intentionally exposes the same HTTP connection API as the Node
 * entry while excluding process spawning, filesystem configuration, and local
 * code execution.
 */

import "./telemetry/configure-browser.js";

export {
  createOAuthProvider,
  type OAuthProviderOptions,
} from "./auth/browser.js";
export {
  BrowserOAuthClientProvider,
  type BrowserOAuthOptions,
} from "./auth/browser.js";
export { onMcpAuthorization } from "./auth/callback.js";
export { completeOAuthFlow, isUnauthorized } from "./auth/flow.js";
export { auth, UnauthorizedError } from "@modelcontextprotocol/client";
/** Browser-compatible MCP client for HTTP servers. */
export { BrowserMCPClient as MCPClient } from "./core/browser.js";
export * from "./core/session.js";
export * from "./core/config.js";

export * from "./transport/base.js";
export * from "./transport/http.js";
export * from "./utils/json-schema-validator.js";

export { logger } from "./utils/logging.js";
export {
  Tel,
  Telemetry,
  setTelemetrySource,
  setProductVersion,
} from "./telemetry/telemetry-browser.js";
export {
  telFetch,
  capturePostHog,
  POSTHOG_HOST,
  POSTHOG_API_KEY,
} from "./telemetry/tel-fetch.js";
export { getPackageVersion, VERSION } from "./utils/version.js";
export { detectFavicon } from "./utils/favicon.js";
