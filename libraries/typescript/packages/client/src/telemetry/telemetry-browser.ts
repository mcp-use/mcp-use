/**
 * Browser entry for telemetry: re-exports the shared Telemetry singleton
 * (localStorage when available; no `node:fs`).
 */
export {
  Telemetry,
  Tel,
  setTelemetrySource,
} from "./telemetry.js";
