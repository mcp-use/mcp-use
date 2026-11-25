/**
 * `useMcpEvent` (PLAN.md §9.6): subscribe to one MCP event from a React
 * component through the client manager's runners, with cursors persisted in
 * `localStorage`.
 *
 * @packageDocumentation
 */

import { useEffect, useRef } from "react";
import type { DeliveryMode, EventEnvelope } from "@mcp-use/events-core";
import type { EventsConnection } from "../events/connection.js";
import { EventsManager, type EventSubscription } from "../events/manager.js";
import { localStorageEventsStore } from "../events/store.js";
import type {
  EventsGap,
  EventsTermination,
  EventsStore,
} from "../events/types.js";
import type { EventsClientError } from "../events/types.js";

/** At most this many concurrent push streams per server per `useMcp` (HTTP/1.1). */
export const MAX_BROWSER_STREAMS = 4;

/** Options of {@link useMcpEvent}. */
export interface UseMcpEventOptions {
  /** `"auto"` = push → poll → webhook; or one forced mode. Default `"auto"`. */
  mode?: "auto" | DeliveryMode;
  /** The app's own receiver route, needed only for webhook-only events. */
  receiverUrl?: string;
  /** `false` (default): cancel on unmount. `true`: close on unmount and resume on remount. */
  keep?: boolean;
  /** Replay floor for the first request. */
  maxAgeMs?: number;
  /** Persistence; default `localStorageEventsStore()`. */
  store?: EventsStore;
  /** Gap callback. */
  onGap?: (gap: EventsGap) => void;
  /** Termination callback. */
  onTerminated?: (t: EventsTermination) => void;
  /** Client error callback. */
  onError?: (err: EventsClientError) => void;
}

/** The part of `useMcp()`'s result this hook needs. */
export interface UseMcpEventSource {
  /** The Events surface of the current connection. */
  eventsConnection: EventsConnection | undefined;
  /** The connection state. */
  state: string;
}

interface ManagerEntry {
  manager: EventsManager;
  streams: number;
  receiverUrl: string | undefined;
  onError: Set<(err: EventsClientError) => void>;
}

const managers = new WeakMap<EventsConnection, ManagerEntry>();

function managerFor(
  conn: EventsConnection,
  receiverUrl: string | undefined,
  store: EventsStore | undefined
): ManagerEntry {
  let entry = managers.get(conn);
  if (!entry) {
    const e: ManagerEntry = {
      streams: 0,
      receiverUrl,
      onError: new Set(),
      manager: undefined as unknown as EventsManager,
    };
    e.manager = new EventsManager({
      connection: async () => conn,
      store: store ?? localStorageEventsStore(),
      prefer: ["push", "poll", "webhook"],
      receiverUrl: () => e.receiverUrl,
      onEventsError: (err) => {
        for (const cb of e.onError) cb(err);
      },
    });
    managers.set(conn, e);
    entry = e;
  }
  if (receiverUrl) entry.receiverUrl = receiverUrl;
  return entry;
}

/**
 * Subscribe to one event for the lifetime of the component.
 *
 * @param mcp - The `useMcp()` result (or anything with `eventsConnection` and `state`).
 * @param name - Event name.
 * @param args - Subscription arguments (compared by value).
 * @param onEvent - Called for each event (data is untrusted).
 * @param options - Mode, receiver URL, keep and callbacks.
 */
export function useMcpEvent<T = unknown>(
  mcp: UseMcpEventSource,
  name: string,
  args: Record<string, unknown>,
  onEvent: (event: EventEnvelope<T>) => void,
  options: UseMcpEventOptions = {}
): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const argsJson = JSON.stringify(args ?? {});
  const conn = mcp.eventsConnection;
  const ready = mcp.state === "ready";

  useEffect(() => {
    if (!conn || !ready) return;
    const opts = optionsRef.current;
    const entry = managerFor(conn, opts.receiverUrl, opts.store);
    const onError = (err: EventsClientError) =>
      optionsRef.current.onError?.(err);
    entry.onError.add(onError);
    let sub: EventSubscription | undefined;
    let stopped = false;
    let countedStream = false;

    // Reserve a stream slot synchronously so concurrent mounts respect the cap.
    const forced: DeliveryMode | undefined =
      opts.mode && opts.mode !== "auto" ? opts.mode : undefined;
    const overCap = !forced && entry.streams >= MAX_BROWSER_STREAMS;
    if (!forced && !overCap) {
      entry.streams += 1;
      countedStream = true;
    }

    void (async () => {
      let mode: DeliveryMode | undefined = forced;
      if (overCap) {
        const d = entry.manager.list("default").find((e) => e.name === name);
        const listed =
          d?.delivery ??
          (await conn.listAllEvents()).events.find((e) => e.name === name)
            ?.delivery ??
          [];
        if (listed.includes("poll")) mode = "poll";
      }
      try {
        const s = await entry.manager.subscribe<T>(
          "default",
          name,
          JSON.parse(argsJson),
          {
            ...(mode ? { mode } : {}),
            ...(opts.maxAgeMs !== undefined ? { maxAgeMs: opts.maxAgeMs } : {}),
            onGap: (g) => optionsRef.current.onGap?.(g),
            onTerminated: (t) => optionsRef.current.onTerminated?.(t),
          }
        );
        if (stopped) {
          await (opts.keep ? s.close() : s.cancel());
          return;
        }
        sub = s;
        if (s.mode !== "push" && countedStream) {
          entry.streams -= 1;
          countedStream = false;
        }
        for await (const e of s) {
          if (stopped) break;
          handlerRef.current(e as EventEnvelope<T>);
        }
      } catch (err) {
        if (countedStream) {
          entry.streams -= 1;
          countedStream = false;
        }
        if ((err as EventsClientError)?.code) onError(err as EventsClientError);
      }
    })();

    return () => {
      stopped = true;
      entry.onError.delete(onError);
      if (countedStream) entry.streams -= 1;
      if (sub) void (optionsRef.current.keep ? sub.close() : sub.cancel());
    };
  }, [conn, ready, name, argsJson]);
}
