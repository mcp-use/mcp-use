/**
 * Browser agent entry — LangChain-dependent exports.
 *
 * Import from `mcp-use/browser/agent` when you need MCPAgent, RemoteAgent,
 * adapters, or observability in the browser. The default `mcp-use/browser`
 * entry intentionally excludes these to keep client bundles free of langchain.
 */

export { MCPAgent } from "./agents/mcp_agent.js";
export { RemoteAgent } from "./agents/remote.js";
export { BaseAdapter } from "./adapters/index.js";
export * from "./agents/utils/index.js";
export {
  type ObservabilityConfig,
  ObservabilityManager,
} from "./observability/index.js";
