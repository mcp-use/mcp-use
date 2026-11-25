/**
 * `@mcp-use/events-core/conformance`: the Events conformance catalog and its
 * raw-HTTP runner with JSON and JUnit reports (D27). One catalog is consumed
 * by the test suite, `mcp-use client <server> events check`, the Inspector
 * conformance panel and the Manufact checklist (P11).
 *
 * @packageDocumentation
 */

export type {
  CheckResult,
  ConformanceCheck,
  ConformanceLevel,
  ConformanceOptions,
  ConformanceProfile,
  ConformanceReport,
  ConformanceResultEntry,
  Harness,
  ReceivedDelivery,
  ReceiverHandle,
} from "./types.js";
export { CATALOG } from "./catalog.js";
export { runConformance } from "./runner.js";
export { toJUnit } from "./report-junit.js";
export { toJSON } from "./report-json.js";
export {
  createSigningReceiver,
  type SigningReceiverOptions,
} from "./receiver.js";
