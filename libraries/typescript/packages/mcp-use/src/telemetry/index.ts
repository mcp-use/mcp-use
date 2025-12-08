import { Telemetry } from "./telemetry.js";

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
  Tool,
  Resource,
  Prompt,
  Content,
} from "./events.js";

export { Telemetry } from "./telemetry.js";
export {
  extractModelInfo,
  getModelName,
  getModelProvider,
  getPackageVersion,
} from "./utils.js";

// Convenience function to set telemetry source globally
export function setTelemetrySource(source: string): void {
  Telemetry.getInstance().setSource(source);
}
