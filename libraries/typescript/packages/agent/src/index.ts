/**
 * @mcp-use/agent — LangChain-based MCP agent for the v2 framework.
 *
 * MCPAgent and RemoteAgent, the LangChain tool adapter, the multi-server
 * ServerManager and its tools, AI SDK interop helpers, and observability
 * integrations. Depends on @mcp-use/client for the underlying MCP client,
 * connectors, and sessions. See MCP-2601.
 *
 * !!! NEVER `export *` from @langchain/core — re-exporting its Message classes
 * forces TypeScript to deeply analyze the package and OOMs the build. Import
 * them directly from "@langchain/core/messages" if needed. Same for StreamEvent
 * (from "@langchain/core/tracers/log_stream").
 */

// Agents
export { MCPAgent } from "./agents/mcp_agent.js";
export { RemoteAgent } from "./agents/remote.js";
export { PROMPTS } from "./agents/index.js";

// AI SDK interop utilities
export * from "./agents/utils/index.js";

// LangChain tool adapter
export { BaseAdapter } from "./adapters/index.js";

// Multi-server manager + its tools
export { ServerManager } from "./managers/server_manager.js";
export * from "./managers/tools/index.js";

// Observability
export {
  ObservabilityManager,
  type ObservabilityConfig,
} from "./observability/index.js";
