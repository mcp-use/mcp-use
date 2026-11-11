/**
 * The official SDK seam, shared by SDK v1 (`@modelcontextprotocol/sdk`), SDK
 * v2 (`@modelcontextprotocol/server`) and the frameworks built on them
 * (Skybridge, `mcp-handler`, mcp-use v1). Both SDK majors dispatch every
 * request through `protocol._requestHandlers.get(method)`, so wrapping the
 * Map's entries (including `initialize`) and overriding the instance's
 * `set()` covers handlers registered before and after `instrument()`,
 * including the ones `McpServer` installs lazily on the first `registerTool`.
 */

import {
  cancelledRequestId,
  cancelRequest,
  onAbort,
  requesterScope,
  watchCancellation,
} from "../cancel.js";
import {
  NO_HEADERS,
  type HeaderReader,
  type Instrumentation,
  type RequestFacts,
  type RequestRecord,
} from "../record.js";
import { recallSession, rememberSession, stdioSessionId } from "../state.js";
import type { AnalyticsClientInfo, Framework, Transport } from "../types.js";

/** Marks an object `instrument()` already handled. */
export const INSTRUMENTED = Symbol.for("@mcp-use/analytics.instrumented");
const ORIGINAL = Symbol.for("@mcp-use/analytics.original");

type Handler = (...args: unknown[]) => unknown;

/** The part of the SDK `Protocol` class the seam relies on. */
export interface ProtocolLike {
  /** Method → handler map consulted on every inbound request. */
  _requestHandlers: Map<string, unknown>;
  /** Connected transport. */
  readonly transport?: unknown;
  /** Client implementation from `initialize` (or the v2 envelope). */
  getClientVersion?: () => unknown;
  /** Server implementation info. */
  _serverInfo?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

/** Whether `value` exposes the SDK request-handler Map. */
export function isProtocol(value: unknown): value is ProtocolLike {
  return isRecord(value) && value["_requestHandlers"] instanceof Map;
}

/** Whether a protocol instance is from SDK v2 (`@modelcontextprotocol/server`). */
export function isV2Protocol(protocol: ProtocolLike): boolean {
  const p = protocol as unknown as Record<string, unknown>;
  return (
    typeof p["_negotiatedWireCodec"] === "function" ||
    typeof p["projectCallToolResult"] === "function"
  );
}

/** Framework label for a bare SDK protocol instance. */
export function sdkFramework(protocol: ProtocolLike): Framework {
  return isV2Protocol(protocol) ? "mcp-sdk-v2" : "mcp-sdk-v1";
}

/** `serverInfo` name and version of a protocol instance. */
export function serverInfoOf(
  protocol: ProtocolLike
): { name?: string; version?: string } | undefined {
  const info = protocol._serverInfo;
  if (!isRecord(info)) return undefined;
  const name = str(info["name"]);
  const version = str(info["version"]);
  return name === undefined && version === undefined
    ? undefined
    : {
        ...(name !== undefined && { name }),
        ...(version !== undefined && { version }),
      };
}

/** Name and version from an MCP `Implementation` object. */
export function clientFrom(value: unknown): AnalyticsClientInfo | undefined {
  if (!isRecord(value)) return undefined;
  const name = str(value["name"]);
  const version = str(value["version"]);
  if (name === undefined && version === undefined) return undefined;
  return {
    ...(name !== undefined && { name }),
    ...(version !== undefined && { version }),
  };
}

/** Header reader over SDK v1's `IsomorphicHeaders` record (lowercase keys). */
function recordHeaders(headers: unknown): HeaderReader {
  if (!isRecord(headers)) return NO_HEADERS;
  return (name) => {
    const value = headers[name.toLowerCase()] ?? headers[name];
    if (Array.isArray(value))
      return value.length > 0 ? value.join(", ") : undefined;
    return typeof value === "string" ? value : undefined;
  };
}

/** Header reader over a Fetch `Headers` instance. */
export function fetchHeaders(headers: unknown): HeaderReader {
  if (!isRecord(headers) || typeof headers["get"] !== "function")
    return NO_HEADERS;
  const get = headers["get"] as (name: string) => string | null;
  return (name) => get.call(headers, name) ?? undefined;
}

function transportKind(
  transport: unknown,
  hasHttp: boolean
): Transport | undefined {
  if (hasHttp) {
    return isRecord(transport) &&
      typeof transport["handlePostMessage"] === "function"
      ? "sse"
      : "streamable-http";
  }
  if (!isRecord(transport)) return undefined;
  const ctor = (transport as { constructor?: { name?: unknown } }).constructor;
  const name = typeof ctor?.name === "string" ? ctor.name : "";
  if ("_stdin" in transport || "_stdout" in transport || /stdio/i.test(name)) {
    return "stdio";
  }
  return undefined;
}

const stdioIdentities = new WeakMap<object, { protocolVersion?: string }>();

interface Begun {
  record: RequestRecord;
  onResult?: (result: unknown) => void;
  /** The signals that abort when the client cancels the request. */
  signals: unknown[];
  /**
   * A 2025-era request on a stateless HTTP server, whose
   * `notifications/cancelled` arrives in another HTTP request: its id and
   * requester.
   */
  watch?: { id: string | number; scope: string };
}

/**
 * The signals that abort when the client cancels the request: SDK v1
 * `extra.signal` and SDK v2 `ctx.mcpReq.signal` (aborted by
 * `notifications/cancelled`, and when the transport closes), and without a
 * session the HTTP request's own `ctx.http.req.signal` (with a session, a
 * resumable stream can still deliver the reply after the POST dropped).
 */
function cancelSignals(extra: unknown, sessionless: boolean): unknown[] {
  if (!isRecord(extra)) return [];
  const mcpReq = isRecord(extra["mcpReq"]) ? extra["mcpReq"] : undefined;
  const http = isRecord(extra["http"]) ? extra["http"] : undefined;
  const req = isRecord(http?.["req"]) ? http["req"] : undefined;
  return [
    extra["signal"],
    mcpReq?.["signal"],
    sessionless ? req?.["signal"] : undefined,
  ];
}

/** Normalize one SDK dispatch (`handler(request, extra | ctx)`) into facts. */
function factsOf(
  protocol: ProtocolLike,
  method: string,
  request: unknown,
  extra: unknown
): RequestFacts {
  const message = isRecord(request) ? request : {};
  const params = isRecord(message["params"])
    ? (message["params"] as Record<string, unknown>)
    : undefined;
  const ctx = isRecord(extra) ? extra : {};
  const mcpReq = isRecord(ctx["mcpReq"]) ? ctx["mcpReq"] : undefined;

  let requestId: unknown;
  let meta: Record<string, unknown> | undefined;
  let sessionId: string | undefined;
  let header: HeaderReader;
  let url: string | undefined;
  let httpMethod: string | undefined;
  let authInfo: unknown;
  let envelope: Record<string, unknown> | undefined;

  if (mcpReq !== undefined) {
    // SDK v2 ServerContext: ctx.sessionId, ctx.mcpReq.{id,_meta,envelope}, ctx.http.{authInfo,req}.
    requestId = mcpReq["id"];
    envelope = isRecord(mcpReq["envelope"]) ? mcpReq["envelope"] : undefined;
    meta = {
      ...(isRecord(mcpReq["_meta"]) ? mcpReq["_meta"] : {}),
      ...envelope,
    };
    sessionId = str(ctx["sessionId"]);
    const http = isRecord(ctx["http"]) ? ctx["http"] : undefined;
    const req = isRecord(http?.["req"]) ? http["req"] : undefined;
    header = fetchHeaders(req?.["headers"]);
    url = typeof req?.["url"] === "string" ? req["url"] : undefined;
    httpMethod =
      typeof req?.["method"] === "string" ? req["method"] : undefined;
    authInfo = http?.["authInfo"];
  } else {
    // SDK v1 RequestHandlerExtra: sessionId, requestId, _meta, authInfo, requestInfo.
    requestId = ctx["requestId"] ?? message["id"];
    meta = isRecord(params?.["_meta"]) ? params["_meta"] : undefined;
    sessionId = str(ctx["sessionId"]);
    const info = isRecord(ctx["requestInfo"]) ? ctx["requestInfo"] : undefined;
    header = recordHeaders(info?.["headers"]);
    const rawUrl = info?.["url"];
    url =
      rawUrl instanceof URL
        ? rawUrl.href
        : typeof rawUrl === "string"
          ? rawUrl
          : undefined;
    httpMethod = info !== undefined ? "POST" : undefined;
    authInfo = ctx["authInfo"];
  }

  sessionId ??= header("mcp-session-id");
  const hasHttp = url !== undefined || header("host") !== undefined;
  const transport = transportKind(protocol.transport, hasHttp);
  if (transport === "stdio") sessionId ??= stdioSessionId();

  const envelopeVersion = str(
    meta?.["io.modelcontextprotocol/protocolVersion"]
  );
  const era2026 = envelopeVersion !== undefined && envelopeVersion >= "2026";
  const stateless = hasHttp ? era2026 || sessionId === undefined : false;
  const remembered =
    transport === "stdio"
      ? stdioIdentities.get(protocol)
      : recallSession(sessionId);

  const protocolVersion =
    method === "initialize"
      ? str(params?.["protocolVersion"])
      : (envelopeVersion ??
        header("mcp-protocol-version") ??
        remembered?.protocolVersion);

  const envelopeClient = clientFrom(
    meta?.["io.modelcontextprotocol/clientInfo"] ??
      meta?.["modelcontextprotocol/clientInfo"]
  );
  let client: AnalyticsClientInfo | undefined;
  if (method === "initialize") {
    client = clientFrom(params?.["clientInfo"]);
  } else {
    client = envelopeClient ?? recallSession(sessionId)?.client;
    // A shared instance's last initialize is only trustworthy with a session
    // (or stdio): stateless servers may serve many clients.
    if (client === undefined && !stateless) {
      try {
        client = clientFrom(protocol.getClientVersion?.());
      } catch {
        client = undefined;
      }
    }
  }

  return {
    method,
    ...(typeof requestId === "string" || typeof requestId === "number"
      ? { requestId }
      : {}),
    ...(params !== undefined && { params }),
    ...(meta !== undefined && { meta }),
    ...(sessionId !== undefined && { sessionId }),
    header,
    ...(url !== undefined && { url }),
    ...(httpMethod !== undefined && { httpMethod }),
    ...(isRecord(authInfo) && { authInfo }),
    ...(transport !== undefined && { transport }),
    stateless,
    ...(protocolVersion !== undefined && { protocolVersion }),
    ...(client !== undefined && { client }),
    raw: extra,
  };
}

function begin(
  protocol: ProtocolLike,
  method: string,
  request: unknown,
  extra: unknown,
  inst: Instrumentation
): Begun | undefined {
  const facts = factsOf(protocol, method, request, extra);
  const record = inst.begin(facts, [request, extra]);
  if (record === undefined) return undefined;
  const signals = cancelSignals(extra, facts.sessionId === undefined);
  if (method !== "initialize") {
    const id = facts.requestId;
    const legacyStateless =
      facts.stateless === true &&
      facts.sessionId === undefined &&
      id !== undefined &&
      !(facts.protocolVersion !== undefined && facts.protocolVersion >= "2026");
    return legacyStateless
      ? { record, signals, watch: { id, scope: requesterScope(facts.header) } }
      : { record, signals };
  }
  return {
    record,
    signals,
    onResult: (result) => {
      const negotiated = isRecord(result)
        ? str(result["protocolVersion"])
        : undefined;
      const identity = {
        ...(facts.client !== undefined && { client: facts.client }),
        ...((negotiated ?? facts.protocolVersion) !== undefined && {
          protocolVersion: negotiated ?? facts.protocolVersion,
        }),
      };
      if (facts.transport === "stdio") stdioIdentities.set(protocol, identity);
      else if (facts.sessionId !== undefined)
        rememberSession(facts.sessionId, identity);
    },
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value["then"] === "function";
}

/** Wrap one request handler; wrapping our own wrapper returns it unchanged. */
function wrapHandler(
  protocol: ProtocolLike,
  method: string,
  handler: Handler,
  inst: Instrumentation
): Handler {
  if ((handler as unknown as Record<symbol, unknown>)[ORIGINAL] !== undefined) {
    return handler;
  }
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    let begun: Begun | undefined;
    try {
      begun = begin(protocol, method, args[0], args[1], inst);
    } catch (error) {
      inst.client.debug(`could not record ${method}`, error);
    }
    if (begun === undefined) return handler.apply(this, args);
    const { record, onResult, signals, watch } = begun;

    // A cancelled request is recorded without an outcome right away; what
    // the handler returns later never reaches the client.
    let unwatch = (): void => undefined;
    try {
      const abandon = (): void => record.abandon();
      const stopSignals = onAbort(signals, abandon);
      const stopWatch =
        watch === undefined
          ? undefined
          : watchCancellation(watch.id, watch.scope, abandon);
      unwatch = () => {
        stopSignals();
        stopWatch?.();
      };
    } catch (error) {
      inst.client.debug(`could not watch ${method} for cancellation`, error);
    }

    let out: unknown;
    try {
      out = handler.apply(this, args);
    } catch (error) {
      unwatch();
      record.fail(error);
      throw error;
    }
    const settle = (result: unknown): unknown => {
      unwatch();
      if (record.finished) return result;
      try {
        onResult?.(result);
      } catch {
        // Session bookkeeping is best effort.
      }
      record.succeed(result);
      return result;
    };
    if (isThenable(out)) {
      return Promise.resolve(out).then(settle, (error: unknown) => {
        unwatch();
        record.fail(error);
        throw error;
      });
    }
    return settle(out);
  };
  Object.defineProperty(wrapped, ORIGINAL, { value: handler });
  return wrapped;
}

/** HTTP headers a transport passed along with an inbound message. */
function transportHeaders(extra: unknown): HeaderReader | undefined {
  if (!isRecord(extra)) return undefined;
  // SDK v2: the Fetch `Request`.
  const request = isRecord(extra["request"]) ? extra["request"] : undefined;
  if (request !== undefined) return fetchHeaders(request["headers"]);
  // SDK v1: `requestInfo.headers`.
  const info = isRecord(extra["requestInfo"])
    ? extra["requestInfo"]
    : undefined;
  return info === undefined ? undefined : recordHeaders(info["headers"]);
}

/**
 * Watch the messages a protocol instance receives for
 * `notifications/cancelled` sent to a stateless HTTP server: the request it
 * cancels runs on another instance (see cancel.ts). The SDKs chain a
 * transport's existing `onmessage` ahead of their own dispatch, so the tap is
 * set on the transport before `connect()` (or around the dispatch of a
 * transport already connected).
 */
function observeCancellations(protocol: ProtocolLike): void {
  const tap = (transport: unknown): void => {
    if (!isRecord(transport)) return;
    const previous = transport["onmessage"];
    transport["onmessage"] = function (
      this: unknown,
      message: unknown,
      extra: unknown
    ): unknown {
      try {
        const id = cancelledRequestId(message);
        const header = id === undefined ? undefined : transportHeaders(extra);
        if (
          id !== undefined &&
          header !== undefined &&
          header("mcp-session-id") === undefined
        ) {
          cancelRequest(id, requesterScope(header));
        }
      } catch {
        // Recording never affects message handling.
      }
      return typeof previous === "function"
        ? (previous as Handler).call(this, message, extra)
        : undefined;
    };
  };
  const target = protocol as unknown as Record<string, unknown>;
  try {
    if (protocol.transport !== undefined) tap(protocol.transport);
  } catch {
    // Best effort.
  }
  const connect = target["connect"];
  if (typeof connect !== "function") return;
  Object.defineProperty(target, "connect", {
    configurable: true,
    writable: true,
    value: function (
      this: unknown,
      transport: unknown,
      ...rest: unknown[]
    ): unknown {
      try {
        tap(transport);
      } catch {
        // Best effort.
      }
      return (connect as Handler).call(this, transport, ...rest);
    },
  });
}

/**
 * Instrument one SDK protocol instance (`Server`, or `McpServer.server`).
 * Idempotent per instance.
 */
export function instrumentProtocol(
  protocol: ProtocolLike,
  inst: Instrumentation
): void {
  const target = protocol as unknown as Record<symbol, unknown>;
  if (target[INSTRUMENTED] === true) return;
  Object.defineProperty(target, INSTRUMENTED, { value: true });
  observeCancellations(protocol);

  const map = protocol._requestHandlers;
  for (const [method, handler] of map) {
    if (typeof handler === "function") {
      Map.prototype.set.call(
        map,
        method,
        wrapHandler(protocol, method, handler as Handler, inst)
      );
    }
  }
  // Compose with an existing instance override (Skybridge installs one).
  const previous = map.set;
  Object.defineProperty(map, "set", {
    configurable: true,
    writable: true,
    value: function set(
      this: Map<string, unknown>,
      method: string,
      handler: unknown
    ) {
      return previous.call(
        this,
        method,
        typeof handler === "function"
          ? wrapHandler(protocol, String(method), handler as Handler, inst)
          : handler
      );
    },
  });
}
