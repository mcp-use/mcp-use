/**
 * `mcp-use/events`: MCP Events types, senders, `defineEvent` and
 * `createEventsEmitter` (PLAN.md §8.6 subpaths).
 *
 * @packageDocumentation
 */

export type {
  Duration,
  DialectId,
  DeliveryMode,
  DeliveryErrorCategory,
  UnsubscribeReason,
  EventSchema,
  EventArgs,
  EventPayloadIn,
  EventPayloadOut,
  MatchContext,
  SubscriptionInfo,
  EventDefinition,
  EmitOptions,
  EmitResult,
  EventRef,
  InferEventArgs,
  InferEventPayload,
  TickReport,
  EventsSdkInfo,
  EventsInfo,
  EventsHealth,
  SubscriptionView,
  StreamView,
  SubscriptionListQuery,
  RevokeFilter,
  ServerEvents,
  WebhookSender,
  WebhookSendRequest,
  WebhookSendResult,
} from "./types.js";
export type { EventsConfig } from "./config.js";
export { EVENTS_DEFAULTS } from "./config.js";
export type { EventsLogRecord } from "./log-records.js";
export { EVENTS_LOG_SCHEMA } from "./log-records.js";
export {
  EventsError,
  EventsConfigError,
  EVENTS_CONFIG_ERROR_CODES,
} from "./errors.js";
export type {
  EventsErrorKind,
  EventRegistrationCode,
  EventsConfigErrorCode,
} from "./errors.js";
export type { DeadLetterView } from "./admin/types.js";
export { nodeWebhookSender } from "./senders/node.js";
export type { NodeWebhookSenderOptions } from "./senders/node.js";
export { fetchWebhookSender } from "./senders/fetch.js";
export { defineEvent, createEventsEmitter } from "./define.js";
export type { EventsEmitter } from "./define.js";
