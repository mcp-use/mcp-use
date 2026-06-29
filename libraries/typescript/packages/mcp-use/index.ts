/**
 * Main package exports for MCP client and MCP agent functionality
 *
 * @deprecated Prefer `@mcp-use/client`, `@mcp-use/agent`, or `mcp-use/client` /
 * `mcp-use/agent` subpaths. Root exports are lazy and emit deprecation warnings.
 *
 * @important Server functionality is exported from `./src/server/index.js` —
 * do NOT export server-related modules from this file.
 */

import type { CreateMessageRequest } from "@modelcontextprotocol/client";
import { Logger, logger } from "./src/logging.js";

export * from "./src/root/agent-reexports.js";
export * from "./src/root/client-reexports.js";

// Export telemetry utilities
export {
  Tel,
  InstrumentationManager,
  manufactCloud,
  posthogAdapter,
  sanitizeInstrumentationEvent,
  setTelemetrySource,
  Telemetry,
  telFetch,
  type InstrumentationManagerOptions,
  type InstrumentationPayloadSanitizerOptions,
  type ManufactCloudInstrumentationOptions,
  type ManufactCloudInstrumentationPayload,
  type McpInstrumentationAdapter,
  type McpInstrumentationEvent,
  type McpInstrumentationEventName,
  type PostHogCapturePayload,
  type PostHogInstrumentationOptions,
  type PostHogLikeClient,
  type ServerInstrumentationContext,
} from "./src/telemetry/index.js";

// Export version information (global)
export { getPackageVersion, VERSION } from "./src/version.js";

// Export new SDK-integrated auth utilities (recommended for new projects)
export {
  BrowserOAuthClientProvider,
  onMcpAuthorization,
  probeAuthParams,
} from "./src/auth/index.js";
export type { ProbeAuthParamsResult } from "./src/auth/index.js";
export type { StoredState } from "./src/auth/types.js";

// Export React hooks
export * from "./src/react/index.js";

// Export utility functions
export * from "./src/utils/index.js";

export { Logger, logger };

// !!! NEVER EXPORT @langchain/core types it causes OOM errors when building the package
// Note: Message classes (AIMessage, BaseMessage, etc.) are not re-exported to avoid
// forcing TypeScript to deeply analyze @langchain/core types.
// Import them directly from "@langchain/core/messages" if needed.
// Same for StreamEvent - import from "@langchain/core/tracers/log_stream"

// Export sampling types for LLM sampling capabilities
export type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/client";

/**
 * Type alias for the params property of CreateMessageRequest.
 * Convenience type for sampling callback functions.
 */
export type CreateMessageRequestParams = CreateMessageRequest["params"];
