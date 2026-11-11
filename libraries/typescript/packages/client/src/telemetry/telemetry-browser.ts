/**
 * Browser entry for telemetry: re-exports the shared Telemetry singleton
 * (localStorage for the user id and settings; no `node:fs`).
 */
export {
  Telemetry,
  Tel,
  setTelemetrySource,
  setProductVersion,
} from "./telemetry.js";
