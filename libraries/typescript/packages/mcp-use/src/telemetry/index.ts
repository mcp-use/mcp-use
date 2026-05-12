export {
  BaseTelemetryEvent,
  MCPAgentExecutionEvent,
  ServerRunEvent,
  ServerInitializeEvent,
  ServerToolCallEvent,
  ServerResourceCallEvent,
  ServerPromptCallEvent,
  ServerContextEvent,
  MCPClientInitEvent,
  ConnectorInitEvent,
  ClientAddServerEvent,
  ClientRemoveServerEvent,
} from "./events.js";

export type {
  MCPAgentExecutionEventData,
  ServerRunEventData,
  ServerInitializeEventData,
  ServerToolCallEventData,
  ServerResourceCallEventData,
  ServerPromptCallEventData,
  ServerContextEventData,
  MCPClientInitEventData,
  ConnectorInitEventData,
  ClientAddServerEventInput,
  ClientRemoveServerEventInput,
  Tool,
  Resource,
  Prompt,
  Content,
} from "./events.js";

export {
  extractModelInfo,
  getModelName,
  getModelProvider,
  getPackageVersion,
} from "./utils.js";

// Re-export telemetry utilities
// Node.js implementation is used as the base and swapped with browser implementation
// in browser bundles via tsup's telemetry-browser-substitution plugin.
export {
  Telemetry,
  Tel,
  setTelemetrySource,
  isBrowserEnvironment,
} from "./telemetry-node.js";

export type { RuntimeEnvironment } from "./telemetry-node.js";

export { telFetch } from "./tel-fetch.js";
