/**
 * Main entry point for the mcp-use server framework.
 *
 * `mcp-use` is the server: MCPServer, the response/elicitation/completion
 * helpers, OAuth providers, session stores, stream managers, widget adapters,
 * and middleware. The MCP client lives in `@mcp-use/client`, the LangChain
 * agent in `@mcp-use/agent`, and the MCP-UI view runtime behind the
 * `mcp-use/react` subpath.
 */

// The full server surface (MCPServer, createMCPServer, helpers, OAuth, sessions,
// widgets, middleware, version, types, ...).
export * from "./src/server/index.js";

// Telemetry utilities
export {
  Tel,
  setTelemetrySource,
  Telemetry,
  telFetch,
} from "./src/telemetry/index.js";

// Elicitation error types
export {
  ElicitationDeclinedError,
  ElicitationTimeoutError,
  ElicitationValidationError,
} from "./src/errors.js";
