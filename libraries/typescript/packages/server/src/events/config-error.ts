/**
 * MCP Events configuration and registration errors (PLAN.md §7.4), free of
 * `@mcp-use/events-core` so the static registry stays out of its bundle.
 *
 * @internal
 */

/** Registration codes thrown synchronously by `server.event()` and `defineEvent()` (§7.1.3). */
export type EventRegistrationCode =
  | "EVENT_NAME_INVALID"
  | "EVENT_DUPLICATE"
  | "EVENT_ARGUMENT_UNMATCHED"
  | "EVENT_PARTITION_INVALID"
  | "EVENT_SCHEMA_UNSUPPORTED"
  | "EVENT_REPLAY_INVALID"
  | "EVENT_POLL_REQUIRES_REPLAY"
  | "EVENT_NO_DELIVERY_MODE";

/** Every configuration and runtime code of §7.4 thrown as {@link EventsConfigError}. */
export type EventsConfigErrorCode =
  | EventRegistrationCode
  | "EVENTS_CONFIG_INVALID"
  | "EVENTS_STORAGE_REQUIRED"
  | "EVENTS_SECRET_REQUIRED"
  | "STORAGE_DRIVER_MISSING"
  | "EVENTS_PLATFORM_BINDING_INCOMPLETE"
  | "STORAGE_UNSUPPORTED"
  | "EVENT_PAYLOAD_INVALID"
  | "EVENT_PAYLOAD_TOO_LARGE"
  | "EVENTS_BACKEND_UNAVAILABLE"
  | "ON_NOT_EVENT"
  | "EVENTS_SDK_CAPABILITY_CONFLICT"
  | "EVENTS_SDK_CLASSIFIER_MISSING"
  | "EVENTS_SDK_EXTENSION_CONFLICT"
  | "MCP_USE_SDK_INTERNALS_CHANGED";

/** Every {@link EventsConfigErrorCode}, for tests and docs. */
export const EVENTS_CONFIG_ERROR_CODES: readonly EventsConfigErrorCode[] = [
  "EVENT_NAME_INVALID",
  "EVENT_DUPLICATE",
  "EVENT_ARGUMENT_UNMATCHED",
  "EVENT_PARTITION_INVALID",
  "EVENT_SCHEMA_UNSUPPORTED",
  "EVENT_REPLAY_INVALID",
  "EVENT_POLL_REQUIRES_REPLAY",
  "EVENT_NO_DELIVERY_MODE",
  "EVENTS_CONFIG_INVALID",
  "EVENTS_STORAGE_REQUIRED",
  "EVENTS_SECRET_REQUIRED",
  "STORAGE_DRIVER_MISSING",
  "EVENTS_PLATFORM_BINDING_INCOMPLETE",
  "STORAGE_UNSUPPORTED",
  "EVENT_PAYLOAD_INVALID",
  "EVENT_PAYLOAD_TOO_LARGE",
  "EVENTS_BACKEND_UNAVAILABLE",
  "ON_NOT_EVENT",
  "EVENTS_SDK_CAPABILITY_CONFLICT",
  "EVENTS_SDK_CLASSIFIER_MISSING",
  "EVENTS_SDK_EXTENSION_CONFLICT",
  "MCP_USE_SDK_INTERNALS_CHANGED",
];

/** A configuration, registration or runtime error with a stable `code` and typed `data`. Tests assert `code` and `data`. */
export class EventsConfigError extends Error {
  /** Stable code. */
  readonly code: EventsConfigErrorCode;
  /** Typed details, for example `{ field }` or `{ missing }`. */
  readonly data?: Record<string, unknown>;

  /**
   * @param code - The stable code.
   * @param message - An actionable message.
   * @param data - Typed details.
   */
  constructor(
    code: EventsConfigErrorCode,
    message: string,
    data?: Record<string, unknown>
  ) {
    super(message);
    this.name = "EventsConfigError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}
