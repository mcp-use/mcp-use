/**
 * `mcp-use/events/admin` (D66): edge-safe admin library. Holds no event
 * definitions and runs no app code.
 *
 * @packageDocumentation
 */

export { openEventsAdmin } from "./open.js";
export { openEventsAdminFromEnv } from "./from-env.js";
export { pingTick, runWakeLoop } from "./wake.js";
export type {
  EventsBinding,
  EventsAdmin,
  EventsStatus,
  DeadLetterView,
  AdminSubscriptionQuery,
  PingTickOptions,
  RunWakeLoopOptions,
  PingTick,
  RunWakeLoop,
  CatalogRecord,
  AttemptRecord,
  TickReport,
} from "./types.js";
