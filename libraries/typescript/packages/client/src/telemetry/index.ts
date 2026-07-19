// Shared Telemetry (node entry installs fs storage via telemetry-node).
export {
  Telemetry,
  Tel,
  setTelemetrySource,
  setProductVersion,
} from "./telemetry-node.js";
export {
  telFetch,
  capturePostHog,
  POSTHOG_HOST,
  POSTHOG_API_KEY,
} from "./tel-fetch.js";
