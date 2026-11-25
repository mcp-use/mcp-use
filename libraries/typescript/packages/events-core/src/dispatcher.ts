/**
 * One router for `notifications/events/*`. A client connection installs a
 * single handler (handlers cannot be removed from the SDK client) and routes
 * every push frame by `_meta["io.modelcontextprotocol/subscriptionId"]` to the
 * stream that owns that id.
 *
 * @packageDocumentation
 */

import {
  EVENTS_NOTIFICATIONS,
  SUBSCRIPTION_ID_META_KEY,
  type EventsActiveParams,
  type EventsErrorParams,
  type EventsEventParams,
  type EventsHeartbeatParams,
  type EventsTerminatedParams,
} from "./wire.js";

/** Receives the push frames of one `events/stream` subscription. */
export interface StreamSink {
  /** `notifications/events/active`: the stream is confirmed, or restarted after a gap. */
  onActive(params: EventsActiveParams): void;
  /** `notifications/events/event`: one event occurrence. */
  onEvent(params: EventsEventParams): void;
  /** `notifications/events/heartbeat`: the stream is alive; persist the cursor. */
  onHeartbeat(params: EventsHeartbeatParams): void;
  /** `notifications/events/error`: a recoverable failure; the stream stays open. */
  onError(params: EventsErrorParams): void;
  /** `notifications/events/terminated`: the server ended the subscription. */
  onTerminated(params: EventsTerminatedParams): void;
}

/** The router returned by {@link createEventsNotificationDispatcher}. */
export interface EventsNotificationDispatcher {
  /**
   * Routes one incoming notification.
   *
   * @param method - The notification method.
   * @param params - The notification params.
   * @returns `true` when it was delivered to an owner or listener; `false` when it is not an Events notification, or nobody owns it.
   */
  route(method: string, params: unknown): boolean;
  /**
   * Registers the sink of one stream.
   *
   * @param subscriptionId - The stream's subscription id (the JSON-RPC id of its `events/stream` request); `7` and `"7"` are different ids.
   * @param sink - Receives the stream's frames.
   * @returns A function that removes the registration.
   * @throws Error when the id already has an owner.
   */
  own(subscriptionId: string | number, sink: StreamSink): () => void;
  /**
   * Registers a listener for `notifications/events/list_changed`.
   *
   * @param cb - Called on every catalog change notification.
   * @returns A function that removes the listener.
   */
  onListChanged(cb: () => void): () => void;
}

const FRAME_HANDLERS: Readonly<Record<string, keyof StreamSink>> = {
  [EVENTS_NOTIFICATIONS.active]: "onActive",
  [EVENTS_NOTIFICATIONS.event]: "onEvent",
  [EVENTS_NOTIFICATIONS.heartbeat]: "onHeartbeat",
  [EVENTS_NOTIFICATIONS.error]: "onError",
  [EVENTS_NOTIFICATIONS.terminated]: "onTerminated",
};

/**
 * Creates a notification router for one client connection.
 *
 * @returns The router.
 */
export function createEventsNotificationDispatcher(): EventsNotificationDispatcher {
  const owners = new Map<string | number, StreamSink>();
  const listChanged = new Set<() => void>();

  return {
    route(method, params) {
      if (method === EVENTS_NOTIFICATIONS.listChanged) {
        if (listChanged.size === 0) return false;
        for (const cb of [...listChanged]) cb();
        return true;
      }
      const handler = FRAME_HANDLERS[method];
      if (!handler) return false;
      if (params === null || typeof params !== "object") return false;
      const meta = (params as { _meta?: unknown })._meta;
      if (meta === null || typeof meta !== "object") return false;
      const id = (meta as Record<string, unknown>)[SUBSCRIPTION_ID_META_KEY];
      if (typeof id !== "string" && typeof id !== "number") return false;
      const sink = owners.get(id);
      if (!sink) return false;
      (sink[handler] as (p: unknown) => void).call(sink, params);
      return true;
    },
    own(subscriptionId, sink) {
      if (owners.has(subscriptionId)) {
        throw new Error(
          `Events stream ${JSON.stringify(subscriptionId)} already has an owner`
        );
      }
      owners.set(subscriptionId, sink);
      return () => {
        if (owners.get(subscriptionId) === sink) owners.delete(subscriptionId);
      };
    },
    onListChanged(cb) {
      listChanged.add(cb);
      return () => {
        listChanged.delete(cb);
      };
    },
  };
}
