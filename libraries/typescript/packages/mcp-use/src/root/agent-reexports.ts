import { lazyBinding, lazyClass, rootRequire } from "./lazy-deprecate.js";

const agentTarget = "@mcp-use/agent";
const loadAgents = () =>
  rootRequire<typeof import("../agents/index.js")>("agents/index.js");
const loadAgentUtils = () =>
  rootRequire<typeof import("../agents/utils/index.js")>(
    "agents/utils/index.js"
  );
const loadAdapters = () =>
  rootRequire<typeof import("../adapters/index.js")>("adapters/index.js");
const loadObservability = () =>
  rootRequire<typeof import("../observability/index.js")>(
    "observability/index.js"
  );
const loadServerManager = () =>
  rootRequire<typeof import("../managers/server_manager.js")>(
    "managers/server_manager.js"
  );
const loadTools = () =>
  rootRequire<
    typeof import("../managers/tools/acquire_active_mcp_server.js") &
      typeof import("../managers/tools/add_server_from_config.js") &
      typeof import("../managers/tools/connect_mcp_server.js") &
      typeof import("../managers/tools/list_mcp_servers.js") &
      typeof import("../managers/tools/release_mcp_server_connection.js") &
      typeof import("../managers/tools/base.js")
  >("managers/tools/index.js");

export const MCPAgent = lazyClass(
  "MCPAgent",
  agentTarget,
  () => loadAgents().MCPAgent
);
export const RemoteAgent = lazyClass(
  "RemoteAgent",
  agentTarget,
  () => loadAgents().RemoteAgent
);
export const PROMPTS = lazyBinding(
  "PROMPTS",
  agentTarget,
  () => loadAgents().PROMPTS
);

export const BaseAdapter = lazyClass(
  "BaseAdapter",
  agentTarget,
  () => loadAdapters().BaseAdapter
);

export const ServerManager = lazyClass(
  "ServerManager",
  agentTarget,
  () => loadServerManager().ServerManager
);

export const ObservabilityManager = lazyClass(
  "ObservabilityManager",
  agentTarget,
  () => loadObservability().ObservabilityManager
);

export const createReadableStreamFromGenerator = lazyBinding(
  "createReadableStreamFromGenerator",
  agentTarget,
  () => loadAgentUtils().createReadableStreamFromGenerator
);

export const streamEventsToAISDK = lazyBinding(
  "streamEventsToAISDK",
  agentTarget,
  () => loadAgentUtils().streamEventsToAISDK
);

export const streamEventsToAISDKWithTools = lazyBinding(
  "streamEventsToAISDKWithTools",
  agentTarget,
  () => loadAgentUtils().streamEventsToAISDKWithTools
);

export const createLLMFromString = lazyBinding(
  "createLLMFromString",
  agentTarget,
  () => loadAgentUtils().createLLMFromString
);

export const getSupportedProviders = lazyBinding(
  "getSupportedProviders",
  agentTarget,
  () => loadAgentUtils().getSupportedProviders
);

export const isValidLLMString = lazyBinding(
  "isValidLLMString",
  agentTarget,
  () => loadAgentUtils().isValidLLMString
);

export const parseLLMString = lazyBinding(
  "parseLLMString",
  agentTarget,
  () => loadAgentUtils().parseLLMString
);

export const MCPServerTool = lazyClass(
  "MCPServerTool",
  agentTarget,
  () => loadTools().MCPServerTool
);

export const AcquireActiveMCPServerTool = lazyClass(
  "AcquireActiveMCPServerTool",
  agentTarget,
  () => loadTools().AcquireActiveMCPServerTool
);

export const AddMCPServerFromConfigTool = lazyClass(
  "AddMCPServerFromConfigTool",
  agentTarget,
  () => loadTools().AddMCPServerFromConfigTool
);

export const ConnectMCPServerTool = lazyClass(
  "ConnectMCPServerTool",
  agentTarget,
  () => loadTools().ConnectMCPServerTool
);

export const ListMCPServersTool = lazyClass(
  "ListMCPServersTool",
  agentTarget,
  () => loadTools().ListMCPServersTool
);

export const ReleaseMCPServerConnectionTool = lazyClass(
  "ReleaseMCPServerConnectionTool",
  agentTarget,
  () => loadTools().ReleaseMCPServerConnectionTool
);

export type { ObservabilityConfig } from "../observability/index.js";
export type { LLMConfig, LLMProvider } from "../agents/utils/llm_provider.js";
export type { SchemaOutputT } from "../managers/tools/base.js";

export type {
  BaseMessage,
  ExplicitModeOptions,
  LanguageModel,
  MCPAgentOptions,
  MCPServerConfig,
  SimplifiedModeOptions,
} from "../agents/types.js";
