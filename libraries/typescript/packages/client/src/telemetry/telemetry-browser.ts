/**
 * Browser entry for telemetry: re-exports the shared Telemetry singleton
 * (localStorage when available; no `node:fs`).
 */
export {
  Telemetry,
  Tel,
  setTelemetrySource,
  setProductVersion,
} from "./telemetry.js";
