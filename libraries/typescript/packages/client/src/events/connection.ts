/**
 * `MCPConnection` Events wrappers (PLAN.md §9.2): list, subscribe,
 * unsubscribe, poll and stream on the events lane, with lenient result
 * validation, the one re-list-and-retry on −32020 and stream lifecycle
 * (active timeout, 3 × heartbeat liveness).
 *
 * @packageDocumentation
 */

import {
  EVENTS_METHODS,
  HEADER_MISMATCH_CODE,
  validateXMcpHeaderAnnotations,
  type EventDescriptor,
  type EventsActiveParams,
  type EventsErrorParams,
  type EventsEventParams,
  type EventsHeartbeatParams,
  type EventsTerminatedParams,
  type PollEventsRequestParams,
  type PollEventsResult,
  type StreamEventsRequestParams,
  type SubscribeEventsRequestParams,
  type SubscribeEventsResult,
  type UnsubscribeEventsRequestParams,
} from "@mcp-use/events-core";
import {
  EventsLaneError,
  type LaneOptions,
  type SdkClientEventsAdapter,
} from "./sdk-adapter.js";
import { sniffEventsCapability, type ConnectionEventsInfo } from "./sniff.js";
import { logger } from "../utils/logging.js";

export type { LaneOptions } from "./sdk-adapter.js";
export type { ConnectionEventsInfo } from "./sniff.js";

/** Default time to wait for `notifications/events/active`. */
export const DEFAULT_ACTIVE_TIMEOUT_MS = 30_000;

/** Handlers of {@link EventsConnection.streamEvents}. */
export interface StreamEventsHandlers {
  /** `active`: confirmed, or restarted after a gap (`truncated`). */
  onActive(p: EventsActiveParams): void;
  /** One event. */
  onEvent(e: EventsEventParams): void;
  /** Heartbeat with the cursor to persist. */
  onHeartbeat?(p: EventsHeartbeatParams): void;
  /** Recoverable error; the stream stays open. */
  onError?(p: EventsErrorParams): void;
}

/** How a stream ended. */
export interface StreamEventsOutcome {
  /** `closed`: graceful. `terminated`: server ended the subscription. `aborted`: local. `dead`: liveness lapsed or the transport failed. `no_active`: no `active` within the timeout. */
  end: "closed" | "terminated" | "aborted" | "dead" | "no_active";
  /** The error, for `terminated` and failures. */
  error?: EventsErrorParams["error"];
  /** Last known cursor. */
  cursor: string | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function lenientDescriptor(raw: unknown): EventDescriptor | undefined {
  if (!isObject(raw) || typeof raw.name !== "string") return undefined;
  const delivery = Array.isArray(raw.delivery)
    ? (raw.delivery.filter(
        (d) => d === "webhook" || d === "push" || d === "poll"
      ) as EventDescriptor["delivery"])
    : (["webhook"] as EventDescriptor["delivery"]);
  return {
    ...(raw as object),
    name: raw.name,
    delivery,
    inputSchema: isObject(raw.inputSchema)
      ? raw.inputSchema
      : { type: "object" },
    payloadSchema: isObject(raw.payloadSchema) ? raw.payloadSchema : {},
  } as EventDescriptor;
}

function isHeaderMismatch(err: unknown): boolean {
  if (err instanceof EventsLaneError) return err.code === HEADER_MISMATCH_CODE;
  return String((err as Error)?.message ?? "").includes(
    String(HEADER_MISMATCH_CODE)
  );
}

/**
 * The Events surface of one MCP connection, over its lane.
 */
export class EventsConnection {
  /** The lane this connection uses. */
  readonly lane: SdkClientEventsAdapter;
  #probed: boolean | undefined;
  #warned = new Set<string>();

  /**
   * @param lane - The events lane installed on this connection's transport.
   */
  constructor(lane: SdkClientEventsAdapter) {
    this.lane = lane;
  }

  /** Events info from raw capabilities (or a successful opt-in probe). */
  get eventsInfo(): ConnectionEventsInfo {
    const info = sniffEventsCapability(this.lane.rawCapabilities());
    if (!info.supported && this.#probed === true) {
      return { ...info, supported: true, via: "probe" };
    }
    return info;
  }

  /**
   * `true`/`false` once known; `undefined` before the handshake.
   *
   * @returns Whether the server supports Events.
   */
  supportsEvents(): boolean | undefined {
    if (this.lane.rawCapabilities() === undefined && this.#probed === undefined)
      return undefined;
    return this.eventsInfo.supported;
  }

  /**
   * Opt-in probe for servers that advertise nothing (never by default).
   *
   * @returns Whether `events/list` succeeded.
   */
  async probe(): Promise<boolean> {
    try {
      await this.listEvents({}, { timeoutMs: 10_000 });
      this.#probed = true;
    } catch {
      this.#probed = false;
    }
    return this.#probed;
  }

  /**
   * One page of `events/list`. Events with invalid `x-mcp-header`
   * annotations are dropped with one warning each.
   *
   * @param params - Optional page cursor.
   * @param options - Lane options.
   * @returns The page.
   */
  async listEvents(
    params: { cursor?: string } = {},
    options?: LaneOptions
  ): Promise<{ events: EventDescriptor[]; nextCursor?: string }> {
    const raw = await this.lane.rpc<unknown>(
      EVENTS_METHODS.list,
      params.cursor !== undefined ? { cursor: params.cursor } : {},
      options
    );
    const r = isObject(raw) ? raw : {};
    const events: EventDescriptor[] = [];
    for (const item of Array.isArray(r.events) ? r.events : []) {
      const d = lenientDescriptor(item);
      if (!d) continue;
      if (!validateXMcpHeaderAnnotations(d.inputSchema).ok) {
        if (!this.#warned.has(d.name)) {
          this.#warned.add(d.name);
          logger.warn(
            `[events] ${d.name} excluded: invalid x-mcp-header annotations`
          );
        }
        continue;
      }
      this.lane.descriptors.set(d.name, d);
      events.push(d);
    }
    return {
      events,
      ...(typeof r.nextCursor === "string" ? { nextCursor: r.nextCursor } : {}),
    };
  }

  /**
   * Every page of `events/list`, with a repeated-cursor guard.
   *
   * @param options - Lane options.
   * @returns All events.
   */
  async listAllEvents(
    options?: LaneOptions
  ): Promise<{ events: EventDescriptor[] }> {
    const all: EventDescriptor[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.listEvents(
        cursor !== undefined ? { cursor } : {},
        options
      );
      all.push(...page.events);
      cursor = page.nextCursor;
      if (cursor !== undefined) {
        if (seen.has(cursor)) break;
        seen.add(cursor);
      }
    } while (cursor !== undefined);
    return { events: all };
  }

  async #withRetry<T>(
    method: string,
    params: Record<string, unknown>,
    options?: LaneOptions
  ): Promise<T> {
    try {
      return await this.lane.rpc<T>(method, params, options);
    } catch (err) {
      if (!isHeaderMismatch(err)) throw err;
      await this.listAllEvents(options).catch(() => undefined);
      return await this.lane.rpc<T>(method, params, options);
    }
  }

  /**
   * `events/subscribe` (webhook mode). Always sends `delivery.mode: "webhook"`
   * and `arguments` as an object.
   *
   * @param params - Subscribe params.
   * @param options - Lane options.
   * @returns The subscribe result.
   */
  async subscribeEvent(
    params: SubscribeEventsRequestParams,
    options?: LaneOptions
  ): Promise<SubscribeEventsResult> {
    const raw = await this.#withRetry<unknown>(
      EVENTS_METHODS.subscribe,
      {
        ...params,
        arguments: params.arguments ?? {},
        delivery: { ...params.delivery, mode: "webhook" },
      },
      options
    );
    const r = isObject(raw) ? raw : {};
    return {
      ...(r as object),
      id: String(r.id ?? ""),
      refreshBefore:
        typeof r.refreshBefore === "string" ? r.refreshBefore : null,
      cursor: typeof r.cursor === "string" ? r.cursor : null,
      truncated: r.truncated === true,
    } as SubscribeEventsResult;
  }

  /**
   * `events/unsubscribe`; NotFound counts as success.
   *
   * @param params - Unsubscribe params.
   * @param options - Lane options.
   */
  async unsubscribeEvent(
    params: UnsubscribeEventsRequestParams,
    options?: LaneOptions
  ): Promise<void> {
    try {
      await this.#withRetry<unknown>(
        EVENTS_METHODS.unsubscribe,
        {
          ...params,
          arguments: params.arguments ?? {},
          delivery: { ...params.delivery, mode: "webhook" },
        },
        options
      );
    } catch (err) {
      if (err instanceof EventsLaneError && err.kind === "notFound") return;
      throw err;
    }
  }

  /**
   * `events/poll`.
   *
   * @param params - Poll params.
   * @param options - Lane options.
   * @returns The poll result (lenient).
   */
  async pollEvents(
    params: PollEventsRequestParams,
    options?: LaneOptions
  ): Promise<PollEventsResult> {
    const raw = await this.#withRetry<unknown>(
      EVENTS_METHODS.poll,
      { ...params, arguments: params.arguments ?? {} },
      options
    );
    const r = isObject(raw) ? raw : {};
    const out: PollEventsResult = {
      events: (Array.isArray(r.events) ? r.events : []).filter(
        isObject
      ) as unknown as PollEventsResult["events"],
      cursor: typeof r.cursor === "string" ? r.cursor : null,
      truncated: r.truncated === true,
      hasMore: r.hasMore === true,
    };
    if (typeof r.nextPollMs === "number" && Number.isFinite(r.nextPollMs)) {
      out.nextPollMs = r.nextPollMs;
    }
    return out;
  }

  /**
   * Open `events/stream`. Resolves when the stream ends; never applies a
   * request timeout. Liveness is 3 × the heartbeat grant from `active`.
   *
   * @param params - Stream params.
   * @param handlers - Frame handlers.
   * @param options - Abort signal and `activeTimeoutMs` (default 30 s).
   * @returns How the stream ended and the last cursor.
   */
  streamEvents(
    params: StreamEventsRequestParams,
    handlers: StreamEventsHandlers,
    options: { signal?: AbortSignal; activeTimeoutMs?: number } = {}
  ): Promise<StreamEventsOutcome> {
    return new Promise((resolve) => {
      let cursor: string | null = params.cursor ?? null;
      let active = false;
      let settled = false;
      let livenessMs = 0;
      const timers: {
        active?: ReturnType<typeof setTimeout>;
      } = {};
      let liveTimer: ReturnType<typeof setTimeout> | undefined;
      let terminated: EventsTerminatedParams | undefined;

      const settle = (o: StreamEventsOutcome) => {
        if (settled) return;
        settled = true;
        if (timers.active) clearTimeout(timers.active);
        if (liveTimer) clearTimeout(liveTimer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve(o);
      };
      const touch = () => {
        if (!livenessMs) return;
        if (liveTimer) clearTimeout(liveTimer);
        liveTimer = setTimeout(() => {
          handle.close();
          settle({ end: "dead", cursor });
        }, livenessMs);
      };

      const handle = this.lane.openStream(
        { ...params, arguments: params.arguments ?? {} },
        {
          onActive: (p) => {
            active = true;
            if (timers.active) clearTimeout(timers.active);
            if (p.cursor !== undefined) cursor = p.cursor;
            livenessMs = 3 * Math.max(1_000, Number(p.heartbeatMs) || 30_000);
            touch();
            handlers.onActive(p);
          },
          onEvent: (e) => {
            if (e.cursor !== undefined && e.cursor !== null) cursor = e.cursor;
            touch();
            handlers.onEvent(e);
          },
          onHeartbeat: (h) => {
            if (h.cursor !== undefined) cursor = h.cursor;
            touch();
            handlers.onHeartbeat?.(h);
          },
          onError: (e) => {
            touch();
            handlers.onError?.(e);
          },
          onTerminated: (t) => {
            terminated = t;
          },
        }
      );

      const onAbort = () => {
        handle.close();
        settle({ end: "aborted", cursor });
      };
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });

      const activeTimeoutMs =
        options.activeTimeoutMs ?? DEFAULT_ACTIVE_TIMEOUT_MS;
      timers.active = setTimeout(() => {
        if (active) return;
        handle.close();
        settle({ end: "no_active", cursor });
      }, activeTimeoutMs);

      void handle.done.then((end) => {
        if (terminated) {
          settle({ end: "terminated", error: terminated.error, cursor });
          return;
        }
        switch (end.reason) {
          case "aborted":
            settle({ end: "aborted", cursor });
            return;
          case "error":
            settle({
              end: "dead",
              cursor,
              ...(end.error
                ? {
                    error: {
                      code: end.error.code,
                      message: end.error.message,
                      ...(isObject(end.error.data)
                        ? { data: end.error.data }
                        : {}),
                    },
                  }
                : {}),
            });
            return;
          case "transport_closed":
            settle({ end: "dead", cursor });
            return;
          default:
            settle({ end: active ? "closed" : "dead", cursor });
        }
      });
    });
  }

  /**
   * On a modern session whose server advertises `listChanged`, send the
   * lane's own `subscriptions/listen` opt-in for `eventsListChanged` (F5).
   */
  optInListChanged(): void {
    if (this.lane.era() !== "modern" || !this.eventsInfo.listChanged) return;
    void this.lane
      .rpc(
        "subscriptions/listen",
        {
          notifications: { eventsListChanged: true },
        },
        { timeoutMs: 0 }
      )
      .catch(() => undefined);
  }
}

/**
 * Create the Events surface of a connection.
 *
 * @param lane - The lane installed on the connection's transport.
 * @returns The connection wrapper.
 */
export function createEventsConnection(
  lane: SdkClientEventsAdapter
): EventsConnection {
  return new EventsConnection(lane);
}
