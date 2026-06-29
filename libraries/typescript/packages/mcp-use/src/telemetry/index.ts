export { extractModelInfo } from "./utils.js";

// Re-export telemetry utilities
// Node.js implementation is used as the base and swapped with browser implementation
// in browser bundles via tsup's telemetry-browser-substitution plugin.
export { Telemetry, Tel, setTelemetrySource } from "./telemetry-node.js";

export { telFetch } from "./tel-fetch.js";
export {
  InstrumentationManager,
  manufactCloud,
  posthogAdapter,
  sanitizeInstrumentationEvent,
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
} from "./instrumentation.js";
