/**
 * MCP Events client barrel (exported from `@mcp-use/client`).
 *
 * @packageDocumentation
 */

export { EventsClientError } from "./types.js";
export type {
  EventsInfo,
  EventsStore,
  ClientSubscriptionRecord,
  ClientWebhookState,
  EventsReceiverOptions,
  ClientDialectOption,
  EventsManagerOptions,
  EventsGap,
  EventsTermination,
  ClientSubscribeOptions,
  EventsRunnerOptions,
  EventsClientErrorCode,
} from "./types.js";

export {
  EventsConnection,
  createEventsConnection,
  DEFAULT_ACTIVE_TIMEOUT_MS,
} from "./connection.js";
export type {
  ConnectionEventsInfo,
  LaneOptions,
  StreamEventsHandlers,
  StreamEventsOutcome,
} from "./connection.js";
export {
  createSdkClientEventsAdapter,
  EventsLaneError,
} from "./sdk-adapter.js";
export type {
  SdkClientEventsAdapter,
  StreamHandle,
  StreamEnd,
  LaneDialect,
  CreateLaneOptions,
} from "./sdk-adapter.js";
export { createEventsFetchWrapper } from "./fetch-wrapper.js";
export { sniffEventsCapability, mergeRawEventsCapabilities } from "./sniff.js";
export {
  EventsManager,
  EventSubscription,
  createEventsManager,
} from "./manager.js";
export type { EventsManagerInit, EventDeliveryInfo } from "./manager.js";
export {
  memoryEventsStore,
  localStorageEventsStore,
  fileEventsStore,
} from "./store.js";
