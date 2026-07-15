// Shared Telemetry (node entry installs fs storage via telemetry-node).
export {
  Telemetry,
  Tel,
  setTelemetrySource,
  setProductVersion,
} from "./telemetry-node.js";
export { telFetch, capturePostHog, captureScarf, buildScarfBeaconUrl, POSTHOG_HOST, POSTHOG_API_KEY, SCARF_GATEWAY_URL, SCARF_GATEWAY_BEACON_URL } from "./tel-fetch.js";
