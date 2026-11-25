/**
 * Client SDK adapter and the events lane (PLAN.md §9.2.2, D77, D80).
 *
 * `events/*` never goes through `Client.request`: the lane wraps the SDK
 * transport, builds its own JSON-RPC messages (ids `mcp-use:ev:<n>`, the era
 * envelope copied from the SDK's own outbound traffic), consumes the matching
 * responses and `notifications/events/*` frames, and passes everything else
 * to the SDK's Protocol unchanged.
 *
 * This is the only client Events module that touches `@modelcontextprotocol/*`
 * (type imports only).
 *
 * @internal
 */

import type {
  JSONRPCMessage,
  MessageExtraInfo,
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/client";
import {
  EVENTS_EXTENSION_ID,
  EVENTS_METHODS,
  EVENTS_NOTIFICATIONS,
  SUBSCRIPTION_ID_META_KEY,
  createEventsNotificationDispatcher,
  decodeEventsError,
  type DecodedEventsError,
  type EventDescriptor,
  type EventsNotificationDispatcher,
  type StreamSink,
} from "@mcp-use/events-core";
import { EventsClientError } from "./types.js";
import { createEventsFetchWrapper } from "./fetch-wrapper.js";

/** First protocol version of the modern (stateless, `_meta` envelope) era. */
export const FIRST_MODERN_PROTOCOL_VERSION = "2026-07-28";

/** Prefix of every lane request id (never `stream:<n>`, 76 F14). */
export const LANE_ID_PREFIX = "mcp-use:ev:";

/** Default lane request timeout for everything except `events/stream`. */
export const DEFAULT_LANE_TIMEOUT_MS = 60_000;

/** Options of one lane request. */
export interface LaneOptions {
  /** Abort the request; the lane sends one `notifications/cancelled`. */
  signal?: AbortSignal;
  /** Request timeout; default 60 s. Never applied to `events/stream`. */
  timeoutMs?: number;
}

/** A raw JSON-RPC request on the events lane (D80). */
export interface EventsLaneRequest {
  method: string;
  params: Record<string, unknown>;
  /** Lane id `mcp-use:ev:<n>`. */
  laneId: string;
  signal?: AbortSignal;
}

/** A JSON-RPC error answered to a lane request. */
export class EventsLaneError extends Error {
  /** JSON-RPC code. */
  readonly code: number;
  /** Error data. */
  readonly data?: unknown;
  /** Decoded Events kind (all three numberings), if any. */
  readonly kind: DecodedEventsError | undefined;
  /** HTTP status when the error came from the HTTP layer. */
  readonly status?: number;

  /**
   * @param error - The JSON-RPC error object.
   * @param status - HTTP status, when known.
   */
  constructor(
    error: { code: number; message: string; data?: unknown },
    status?: number
  ) {
    super(error.message);
    this.name = "EventsLaneError";
    this.code = error.code;
    if (error.data !== undefined) this.data = error.data;
    this.kind = decodeEventsError(error);
    if (status !== undefined) this.status = status;
  }
}

/** Handle of one open `events/stream` on the lane. */
export interface StreamHandle {
  /** The lane id, echoed by the server as `_meta[SUBSCRIPTION_ID_META_KEY]`. */
  readonly id: string;
  /** Resolves when the stream ends. */
  readonly done: Promise<StreamEnd>;
  /** Abort the stream: closes the body and sends one `notifications/cancelled`. */
  close(): void;
}

/** How a lane stream ended. */
export interface StreamEnd {
  /** `result`: final result frame. `body_end`: body ended without one. `error`: JSON-RPC error. `aborted`: closed locally. `transport_closed`: the transport closed. */
  reason: "result" | "body_end" | "error" | "aborted" | "transport_closed";
  /** The error for `reason: "error"`. */
  error?: { code: number; message: string; data?: unknown };
}

/** Result of the client D79 probes. */
export type SdkClientProbeReport = Record<string, "ok" | "fail">;

/** Dialect signals the lane applies (from `KNOWN_CLIENTS[row].emulate`, §9.2.5). */
export interface LaneDialect {
  /** Declare `extensions[EVENTS_EXTENSION_ID]` in the modern envelope. Default true. */
  declareExtension?: boolean;
  /** Send `Mcp-Name` on modern `events/*` POSTs. Default true. */
  sendMcpName?: boolean;
}

/** Everything the client Events layers need from the SDK. */
export interface SdkClientEventsAdapter {
  /** Wrap the transport mcp-use constructs before `client.connect`. */
  wrapTransport(inner: Transport): Transport;
  /** Wrap the fetch injected into the SDK HTTP transport. */
  wrapFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch;
  /** Raw server capabilities as received (D34). */
  rawCapabilities(): Record<string, unknown> | undefined;
  /** The negotiated protocol era. */
  era(): "legacy" | "modern" | undefined;
  /** Send one `events/*` request on the lane. */
  rpc<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    opts?: LaneOptions
  ): Promise<T>;
  /** Open an `events/stream` on the lane; frames are routed to `sink`. */
  openStream(params: Record<string, unknown>, sink: StreamSink): StreamHandle;
  /** Send one request on the events lane (frozen WP-03 form of {@link rpc}). */
  request(req: EventsLaneRequest): Promise<unknown>;
  /** Frozen WP-03 form of {@link openStream}. */
  stream(
    req: EventsLaneRequest,
    onNotification: (method: string, params: unknown) => void
  ): Promise<unknown>;
  /** Observe every `notifications/events/*` the lane consumes. */
  onEventsNotification(
    handler: (method: string, params: unknown) => void
  ): () => void;
  /** Register a `notifications/events/list_changed` listener. */
  onListChanged(cb: () => void): () => void;
  /** Refuse an SDK events extension (D77). */
  checkExtensions(list: readonly { id: string }[]): void;
  /** Run the client D79 probes. */
  probe(): SdkClientProbeReport;
  /** The notification dispatcher of this connection. */
  readonly dispatcher: EventsNotificationDispatcher;
  /** Allocate the next lane id. */
  nextId(): string;
  /** Called by the fetch wrapper when a lane stream body ends. */
  notifyStreamBodyEnd(id: string): void;
  /** Caller-supplied headers (connection config), for the Mcp-Name conflict check. */
  callerHeaders: Record<string, string>;
  /** Dialect signals. */
  dialect: Required<LaneDialect>;
  /** Descriptor cache from `events/list` (for `Mcp-Param-*`). */
  descriptors: Map<string, EventDescriptor>;
}

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

interface OpenStream {
  sink: StreamSink;
  finish(end: StreamEnd): void;
}

/** Options of {@link createSdkClientEventsAdapter}. */
export interface CreateLaneOptions {
  /** Dialect signals. */
  dialect?: LaneDialect;
  /** Headers configured on the connection (for `MCP_NAME_CONFLICT`). */
  headers?: Record<string, string>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Create the events lane for one connection.
 *
 * @param options - Dialect and caller headers; an SDK client instance (the
 * frozen WP-03 signature) is accepted and ignored.
 * @returns The adapter.
 */
export function createSdkClientEventsAdapter(
  options?: CreateLaneOptions | unknown
): SdkClientEventsAdapter {
  const opts: CreateLaneOptions =
    isObject(options) && !("request" in options)
      ? (options as CreateLaneOptions)
      : {};
  const dispatcher = createEventsNotificationDispatcher();
  const pending = new Map<string, Pending>();
  const streams = new Map<string, OpenStream>();
  const observers = new Set<(method: string, params: unknown) => void>();
  const handshakeIds = new Set<string | number>();
  let counter = 0;
  let inner: Transport | undefined;
  let rawCaps: Record<string, unknown> | undefined;
  let protocolVersion: string | undefined;
  let envelope: Record<string, unknown> | undefined;

  const dialect: Required<LaneDialect> = {
    declareExtension: opts.dialect?.declareExtension ?? true,
    sendMcpName: opts.dialect?.sendMcpName ?? true,
  };

  const era = (): "legacy" | "modern" | undefined => {
    if (protocolVersion === undefined) return envelope ? "modern" : undefined;
    return protocolVersion >= FIRST_MODERN_PROTOCOL_VERSION
      ? "modern"
      : "legacy";
  };

  const buildMessage = (
    id: string,
    method: string,
    params: Record<string, unknown>
  ): JSONRPCMessage => {
    let p = params;
    if (era() === "modern" && envelope) {
      const meta: Record<string, unknown> = {
        ...envelope,
        ...(isObject(params._meta) ? params._meta : {}),
      };
      const capsKey = Object.keys(envelope).find((k) =>
        k.endsWith("clientCapabilities")
      );
      if (capsKey && dialect.declareExtension) {
        const caps = isObject(meta[capsKey]) ? { ...meta[capsKey] } : {};
        const ext = isObject(caps.extensions) ? { ...caps.extensions } : {};
        ext[EVENTS_EXTENSION_ID] = ext[EVENTS_EXTENSION_ID] ?? {};
        caps.extensions = ext;
        meta[capsKey] = caps;
      }
      p = { ...params, _meta: meta };
    }
    return { jsonrpc: "2.0", id, method, params: p } as JSONRPCMessage;
  };

  const sendRaw = async (message: JSONRPCMessage): Promise<void> => {
    if (!inner) {
      throw new EventsClientError(
        "not_supported",
        "Events lane is not attached to a transport"
      );
    }
    await inner.send(message);
  };

  const cancel = (id: string, reason: string): void => {
    void sendRaw({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: id, reason },
    } as JSONRPCMessage).catch(() => undefined);
  };

  /** Returns true when the lane consumed the message. */
  const intercept = (message: JSONRPCMessage): boolean => {
    const m = message as Record<string, unknown>;
    const id = m.id;
    if (typeof id === "string" && id.startsWith(LANE_ID_PREFIX)) {
      if ("result" in m || "error" in m) {
        const stream = streams.get(id);
        if (stream) {
          stream.finish(
            "error" in m
              ? {
                  reason: "error",
                  error: m.error as StreamEnd["error"],
                }
              : { reason: "result" }
          );
          return true;
        }
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          if ("error" in m) {
            p.reject(
              new EventsLaneError(
                m.error as { code: number; message: string; data?: unknown }
              )
            );
          } else {
            p.resolve(m.result);
          }
        }
        return true;
      }
    }
    if (
      (id === undefined || id === null) &&
      typeof m.method === "string" &&
      m.method.startsWith("notifications/events/")
    ) {
      for (const o of [...observers]) o(m.method, m.params);
      if (m.method === EVENTS_NOTIFICATIONS.listChanged) {
        dispatcher.route(m.method, m.params);
        return true;
      }
      const meta = isObject(m.params) ? m.params._meta : undefined;
      const sid = isObject(meta) ? meta[SUBSCRIPTION_ID_META_KEY] : undefined;
      if (typeof sid === "string" && sid.startsWith(LANE_ID_PREFIX)) {
        // Frames for a lane id with no owner are dropped, never forwarded.
        dispatcher.route(m.method, m.params);
        return true;
      }
    }
    // Capture raw handshake capabilities (the SDK schema strips `events`).
    if (
      (typeof id === "string" || typeof id === "number") &&
      handshakeIds.has(id)
    ) {
      handshakeIds.delete(id);
      const result = m.result;
      if (isObject(result)) {
        if (isObject(result.capabilities)) rawCaps = result.capabilities;
        if (typeof result.protocolVersion === "string") {
          protocolVersion = result.protocolVersion;
        }
        if (
          Array.isArray(result.supportedVersions) &&
          protocolVersion === undefined
        ) {
          // server/discover: the SDK picks the version; setProtocolVersion follows.
        }
      }
    }
    return false;
  };

  const observeOutbound = (message: JSONRPCMessage): void => {
    const m = message as Record<string, unknown>;
    if (typeof m.method !== "string") return;
    if (
      (m.method === "initialize" || m.method === "server/discover") &&
      (typeof m.id === "string" || typeof m.id === "number")
    ) {
      handshakeIds.add(m.id);
    }
    const params = isObject(m.params) ? m.params : undefined;
    const meta = params && isObject(params._meta) ? params._meta : undefined;
    if (meta) {
      const keys = Object.keys(meta).filter(
        (k) =>
          k.endsWith("protocolVersion") ||
          k.endsWith("clientInfo") ||
          k.endsWith("clientCapabilities")
      );
      if (keys.length >= 2) {
        envelope = Object.fromEntries(keys.map((k) => [k, meta[k]]));
        const pv = keys.find((k) => k.endsWith("protocolVersion"));
        if (pv && typeof meta[pv] === "string") {
          protocolVersion = meta[pv] as string;
        }
      }
    }
  };

  const adapter: SdkClientEventsAdapter = {
    dispatcher,
    dialect,
    descriptors: new Map(),
    callerHeaders: { ...(opts.headers ?? {}) },

    wrapTransport(t: Transport): Transport {
      inner = t;
      let downstream: Transport["onmessage"];
      const wrapped: Transport = {
        start: () => t.start(),
        send: (message: JSONRPCMessage, o?: TransportSendOptions) => {
          observeOutbound(message);
          return t.send(message, o);
        },
        close: () => t.close(),
        get sessionId() {
          return t.sessionId;
        },
        get onclose() {
          return t.onclose;
        },
        set onclose(fn) {
          t.onclose = () => {
            for (const s of [...streams.values()]) {
              s.finish({ reason: "transport_closed" });
            }
            for (const [k, p] of pending) {
              pending.delete(k);
              p.reject(new Error("Transport closed"));
            }
            fn?.();
          };
        },
        get onerror() {
          return t.onerror;
        },
        set onerror(fn) {
          t.onerror = fn;
        },
        get onmessage() {
          return downstream;
        },
        set onmessage(fn) {
          downstream = fn;
          t.onmessage = (<T extends JSONRPCMessage>(
            message: T,
            extra?: MessageExtraInfo
          ) => {
            if (intercept(message)) return;
            fn?.(message, extra);
          }) as Transport["onmessage"];
        },
        setProtocolVersion: (v: string) => {
          protocolVersion = v;
          t.setProtocolVersion?.(v);
        },
      };
      if (t.setSupportedProtocolVersions) {
        wrapped.setSupportedProtocolVersions = (v: string[]) =>
          t.setSupportedProtocolVersions?.(v);
      }
      return wrapped;
    },

    wrapFetch(f) {
      return createEventsFetchWrapper(f, adapter);
    },

    rawCapabilities: () => rawCaps,
    era,

    nextId() {
      counter += 1;
      return `${LANE_ID_PREFIX}${counter}`;
    },

    async rpc<T>(
      method: string,
      params: Record<string, unknown>,
      o: LaneOptions = {}
    ): Promise<T> {
      const id = adapter.nextId();
      return (await laneRequest(id, method, params, o)) as T;
    },

    openStream(params, sink) {
      const id = adapter.nextId();
      let finished = false;
      let resolveDone!: (e: StreamEnd) => void;
      const done = new Promise<StreamEnd>((r) => (resolveDone = r));
      const release = dispatcher.own(id, sink);
      const finish = (end: StreamEnd) => {
        if (finished) return;
        finished = true;
        streams.delete(id);
        release();
        resolveDone(end);
      };
      streams.set(id, { sink, finish });
      void sendRaw(buildMessage(id, EVENTS_METHODS.stream, params)).catch(
        (err: unknown) =>
          finish({
            reason: "error",
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : String(err),
              ...(typeof (err as { code?: unknown })?.code === "number"
                ? { data: { status: (err as { code: number }).code } }
                : {}),
            },
          })
      );
      return {
        id,
        done,
        close() {
          if (finished) return;
          cancel(id, "client closed the stream");
          finish({ reason: "aborted" });
        },
      };
    },

    request(req) {
      return laneRequest(req.laneId, req.method, req.params, {
        ...(req.signal ? { signal: req.signal } : {}),
      });
    },

    async stream(req, onNotification) {
      const forward =
        (method: string) =>
        (p: unknown): void =>
          onNotification(method, p);
      const handle = adapter.openStream(req.params, {
        onActive: forward(EVENTS_NOTIFICATIONS.active),
        onEvent: forward(EVENTS_NOTIFICATIONS.event),
        onHeartbeat: forward(EVENTS_NOTIFICATIONS.heartbeat),
        onError: forward(EVENTS_NOTIFICATIONS.error),
        onTerminated: forward(EVENTS_NOTIFICATIONS.terminated),
      });
      req.signal?.addEventListener("abort", () => handle.close(), {
        once: true,
      });
      return handle.done;
    },

    onEventsNotification(handler) {
      observers.add(handler);
      return () => observers.delete(handler);
    },

    onListChanged(cb) {
      return dispatcher.onListChanged(cb);
    },

    checkExtensions(list) {
      if (list.some((e) => e.id === EVENTS_EXTENSION_ID)) {
        throw new EventsClientError(
          "EVENTS_SDK_EXTENSION_CONFLICT",
          `The SDK extension ${EVENTS_EXTENSION_ID} must not be installed; mcp-use owns the events lane`
        );
      }
    },

    probe() {
      return { "C-P1": inner || !rawCaps ? "ok" : "fail" };
    },

    notifyStreamBodyEnd(id) {
      const s = streams.get(id);
      if (!s) return;
      // Give a final result frame that raced the body end a tick to arrive.
      setTimeout(() => s.finish({ reason: "body_end" }), 0);
    },
  };

  function laneRequest(
    id: string,
    method: string,
    params: Record<string, unknown>,
    o: LaneOptions
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        o.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        cleanup();
        cancel(id, "aborted");
        reject(o.signal?.reason ?? new Error("Aborted"));
      };
      if (o.signal?.aborted) {
        reject(o.signal.reason ?? new Error("Aborted"));
        return;
      }
      pending.set(id, {
        resolve: (v) => {
          cleanup();
          resolve(v);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
      });
      o.signal?.addEventListener("abort", onAbort, { once: true });
      const timeoutMs = o.timeoutMs ?? DEFAULT_LANE_TIMEOUT_MS;
      if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
        timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          cleanup();
          cancel(id, "timeout");
          reject(
            new EventsLaneError({
              code: -32001,
              message: `${method} timed out after ${timeoutMs} ms`,
            })
          );
        }, timeoutMs);
      }
      sendRaw(buildMessage(id, method, params)).catch((err: unknown) => {
        if (!pending.delete(id)) return;
        cleanup();
        const status =
          typeof (err as { code?: unknown })?.code === "number"
            ? (err as { code: number }).code
            : undefined;
        if (status === 401 || /\b401\b/.test(String(err))) {
          reject(
            new EventsClientError("auth_required", "Server returned 401", {
              data: { method },
            })
          );
          return;
        }
        reject(err);
      });
    });
  }

  return adapter;
}
