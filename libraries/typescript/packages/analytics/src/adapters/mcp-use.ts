/**
 * mcp-use v2 (`MCPServer` from `mcp-use`). It builds a fresh SDK server per
 * request from a private registry, so the protocol seam has no stable
 * target. Two first-party seams are used instead:
 *
 * - `server.use("mcp:<method>")` exact-method middleware for the six methods
 *   mcp-use intercepts (`tools/call`, `tools/list`, `resources/read`,
 *   `resources/list`, `prompts/get`, `prompts/list`): the framework's context
 *   and the handler timing;
 * - a Hono middleware on the MCP route, which reads the request body and a
 *   clone of the response in the background and provides the HTTP status.
 *   It records everything the middleware does not see (`initialize`, `ping`,
 *   a `tools/call` for an unknown tool, …) and settles the middleware's
 *   records from the reply the client received: mcp-use and the SDK validate
 *   a result after the middleware chain (output schemas, result shape) and
 *   answer an error the handler's result does not show.
 *
 * Every JSON-RPC request of an HTTP exchange is recorded once: the first
 * seam to claim its wire message owns it, and the other one never records
 * it. A request the client cancelled (it aborted the HTTP request, which
 * mcp-use answers with `499`, or sent `notifications/cancelled`) is recorded
 * without an outcome, even when its handler returns afterwards.
 *
 * Both must be registered before `listen()` / the first request.
 */

import {
  cancelledRequestId,
  cancelRequest,
  onAbort,
  requesterScope,
  watchCancellation,
} from "../cancel.js";
import type {
  HeaderReader,
  Instrumentation,
  RequestFacts,
  RequestRecord,
} from "../record.js";
import { monotonicNow, vercelWaitUntil } from "../runtime.js";
import { warnOncePerProcess } from "../state.js";
import { clientFrom, fetchHeaders } from "./protocol.js";
import {
  readResponses,
  requestMessages,
  type JsonRpcRequestMessage,
} from "./jsonrpc.js";

const HOOKED_METHODS = [
  "tools/call",
  "tools/list",
  "resources/read",
  "resources/list",
  "prompts/get",
  "prompts/list",
] as const;

/** mcp-use list middleware returns item arrays; rebuild the protocol result. */
const LIST_RESULT_KEY: Record<string, string> = {
  "tools/list": "tools",
  "resources/list": "resources",
  "prompts/list": "prompts",
};

/** What mcp-use answers when the client closed the request before the reply. */
const CLIENT_CLOSED_REQUEST = 499;

const ENVELOPE_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";

/** The part of mcp-use's `MCPServer` this adapter uses. */
interface McpUseServerLike {
  use(...args: unknown[]): unknown;
  readonly basePath?: unknown;
}

interface HonoContextLike {
  req: { raw: Request; method: string; path?: string };
  res: Response;
}

/** A middleware record whose outcome waits for the reply the client receives. */
interface Held {
  readonly record: RequestRecord;
  /** Settle with what the handler returned or threw, when no reply is read. */
  readonly provisional: () => void;
}

/** A middleware record whose handler is running. */
interface Active {
  readonly record: RequestRecord;
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
  /** The wire message this record claimed, once matched. */
  message?: JsonRpcRequestMessage;
}

interface Exchange {
  readonly skip: boolean;
  readonly request: Request;
  readonly header: HeaderReader;
  readonly startedAt: { wall: number; mono: number };
  messages: JsonRpcRequestMessage[] | undefined;
  readonly parsed: Promise<void>;
  /** Messages a middleware record owns (recorded once, by the middleware). */
  readonly claimed: Set<JsonRpcRequestMessage>;
  /** Middleware records whose handler is still running. */
  readonly active: Set<Active>;
  /** Claimed messages still waiting for their reply. */
  readonly held: Map<JsonRpcRequestMessage, Held>;
  /** Messages whose reply was read off the wire, or that the HTTP layer recorded. */
  readonly answered: Set<JsonRpcRequestMessage>;
  /** Messages the client cancelled with `notifications/cancelled`. */
  readonly cancelled: Set<JsonRpcRequestMessage>;
  /** Stops watching the exchange's messages for `notifications/cancelled`. */
  readonly unwatch: Array<() => void>;
  readonly records: RequestRecord[];
  status: number | undefined;
  /** The client went away before the reply (the request aborted, or `499`). */
  aborted: boolean;
  /** The response was read (or never will be): later holds settle at once. */
  closed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Whether `value` looks like mcp-use v2's `MCPServer`. */
export function isMcpUseServer(value: unknown): value is McpUseServerLike {
  return (
    isRecord(value) &&
    typeof value["use"] === "function" &&
    typeof value["on"] === "function" &&
    typeof value["tool"] === "function" &&
    typeof value["listen"] === "function" &&
    typeof value["fetch"] === "function" &&
    isRecord(value["app"])
  );
}

function pathname(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/** A URI in WHATWG-normalized form (what mcp-use hands the middleware), else as is. */
function normalizedUri(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

/** The 2026-era envelope protocol version a wire message carries in `_meta`. */
function envelopeVersion(
  params: Record<string, unknown> | undefined
): string | undefined {
  const meta = isRecord(params?.["_meta"]) ? params["_meta"] : undefined;
  return str(meta?.[ENVELOPE_PROTOCOL_VERSION]);
}

function sameTarget(
  message: JsonRpcRequestMessage,
  method: string,
  params: unknown
): boolean {
  if (message.method !== method) return false;
  const p = isRecord(params) ? params : {};
  const m = message.params ?? {};
  if (method === "tools/call" || method === "prompts/get")
    return m["name"] === p["name"];
  // mcp-use passes `uri.href`: `https://example.com` arrives as
  // `https://example.com/`, `notes://café` as `notes://caf%C3%A9`.
  if (method === "resources/read")
    return (
      m["uri"] === p["uri"] ||
      normalizedUri(m["uri"]) === normalizedUri(p["uri"])
    );
  return true;
}

/**
 * The wire message a middleware call handled: the unclaimed message with the
 * same method and target, or the only unclaimed message with that method
 * (a middleware call can only be for a message of its own HTTP request).
 */
function findMessage(
  exchange: Exchange,
  method: string,
  params: unknown
): JsonRpcRequestMessage | undefined {
  const candidates = (exchange.messages ?? []).filter(
    (m) =>
      m.method === method &&
      !exchange.claimed.has(m) &&
      !exchange.answered.has(m)
  );
  return (
    candidates.find((m) => sameTarget(m, method, params)) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  );
}

/**
 * The running middleware record that handles `message`: the unmatched one
 * with the same method and target, or the only unmatched one with that
 * method.
 */
function activeFor(
  exchange: Exchange,
  message: JsonRpcRequestMessage
): Active | undefined {
  const candidates = [...exchange.active].filter(
    (entry) => entry.message === undefined && entry.method === message.method
  );
  return (
    candidates.find((entry) =>
      sameTarget(message, entry.method, entry.params)
    ) ?? (candidates.length === 1 ? candidates[0] : undefined)
  );
}

/** Give `message` to a middleware record: the HTTP layer leaves it alone. */
function link(
  exchange: Exchange,
  entry: Active,
  message: JsonRpcRequestMessage
): void {
  exchange.claimed.add(message);
  entry.message = message;
  entry.record.matchWire(
    message.id,
    message.params,
    envelopeVersion(message.params)
  );
}

/** JSON-RPC code the SDK rethrows from tools/call instead of wrapping it. */
const URL_ELICITATION_REQUIRED = -32042;

/**
 * The tool result the SDK sends for a tool that threw: mcp-use middleware
 * runs inside the SDK's `tools/call` handler, which turns the throw into an
 * `isError` result, so record what the client (and the gateway) sees.
 */
function asToolError(error: unknown): Record<string, unknown> | undefined {
  if (isRecord(error) && error["code"] === URL_ELICITATION_REQUIRED)
    return undefined;
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Instrument an mcp-use v2 `MCPServer`. Returns false when it already started. */
export function instrumentMcpUse(
  server: McpUseServerLike,
  inst: Instrumentation
): boolean {
  const basePath =
    typeof server.basePath === "string" ? server.basePath : "/mcp";
  const exchanges = new WeakMap<Request, Exchange>();

  const facts = (
    exchange: Exchange | undefined,
    method: string,
    params: Record<string, unknown> | undefined,
    header: HeaderReader,
    url: string | undefined,
    extra: Partial<RequestFacts>
  ): RequestFacts => {
    const meta = isRecord(params?.["_meta"])
      ? (params["_meta"] as Record<string, unknown>)
      : undefined;
    const sessionId = header("mcp-session-id");
    // initialize names the version it asks for (no header exists yet); a
    // 2026-era request carries it in its envelope, later 2025-era ones in
    // the MCP-Protocol-Version header.
    const protocolVersion =
      (method === "initialize"
        ? str(params?.["protocolVersion"])
        : undefined) ??
      str(meta?.[ENVELOPE_PROTOCOL_VERSION]) ??
      header("mcp-protocol-version");
    const client = clientFrom(
      method === "initialize"
        ? params?.["clientInfo"]
        : meta?.["io.modelcontextprotocol/clientInfo"]
    );
    return {
      method,
      ...(params !== undefined && { params }),
      ...(meta !== undefined && { meta }),
      ...(sessionId !== undefined && { sessionId }),
      header,
      ...(url !== undefined && { url }),
      httpMethod: exchange?.request.method ?? "POST",
      transport: "streamable-http",
      // mcp-use v2 serves every era without sessions.
      stateless: true,
      ...(protocolVersion !== undefined && { protocolVersion }),
      ...(client !== undefined && { client }),
      raw: undefined,
      ...extra,
    };
  };

  const attach = (
    exchange: Exchange | undefined,
    record: RequestRecord
  ): void => {
    if (exchange === undefined) return;
    exchange.records.push(record);
    if (exchange.status !== undefined && record.http !== undefined) {
      record.http.status = exchange.status;
    }
  };

  const recordFromWire = (
    exchange: Exchange,
    message: JsonRpcRequestMessage
  ): RequestRecord | undefined => {
    const record = inst.begin(
      facts(
        exchange,
        message.method,
        message.params,
        exchange.header,
        exchange.request.url,
        {
          requestId: message.id,
          raw: { request: exchange.request, message },
        }
      ),
      [message],
      exchange.startedAt
    );
    if (record !== undefined) attach(exchange, record);
    return record;
  };

  /**
   * The client cancelled `message` with `notifications/cancelled` (in an HTTP
   * request of its own): record it without an outcome now if a record owns
   * it, else mark it so whichever seam records it does so.
   */
  const cancelMessage = (
    exchange: Exchange,
    message: JsonRpcRequestMessage
  ): void => {
    if (exchange.cancelled.has(message) || exchange.answered.has(message))
      return;
    exchange.cancelled.add(message);
    const held = exchange.held.get(message);
    if (held !== undefined) {
      exchange.held.delete(message);
      exchange.answered.add(message);
      held.record.abandon();
      return;
    }
    for (const entry of exchange.active) {
      if (entry.message === message) {
        entry.record.abandon();
        return;
      }
    }
    const entry = activeFor(exchange, message);
    if (entry !== undefined) {
      link(exchange, entry, message);
      entry.record.abandon();
    }
  };

  const middleware =
    (method: string) =>
    async (ctx: unknown, next: () => Promise<unknown>): Promise<unknown> => {
      let record: RequestRecord | undefined;
      let exchange: Exchange | undefined;
      let params: Record<string, unknown> | undefined;
      try {
        const c = isRecord(ctx) ? ctx : {};
        const honoRequest = isRecord(c["request"]) ? c["request"] : undefined;
        const raw =
          honoRequest?.["raw"] instanceof Request
            ? honoRequest["raw"]
            : undefined;
        exchange = raw === undefined ? undefined : exchanges.get(raw);
        if (exchange?.skip !== true) {
          params = isRecord(c["params"])
            ? (c["params"] as Record<string, unknown>)
            : undefined;
          const session = isRecord(c["session"])
            ? str(c["session"]["sessionId"])
            : undefined;
          const clientContext = isRecord(c["client"]) ? c["client"] : undefined;
          const info =
            typeof clientContext?.["info"] === "function"
              ? clientFrom(
                  (clientContext["info"] as () => unknown).call(clientContext)
                )
              : undefined;
          const header = exchange?.header ?? fetchHeaders(raw?.headers);
          const base = facts(exchange, method, params, header, raw?.url, {
            raw: ctx,
            ...(isRecord(c["auth"]) && { authInfo: c["auth"] }),
          });
          if (session !== undefined) base.sessionId = session;
          if (info !== undefined) base.client = info;
          record = inst.begin(base, [ctx]);
          if (record !== undefined) attach(exchange, record);
        }
      } catch (error) {
        inst.client.debug(`could not record ${method}`, error);
      }
      if (record === undefined) return next();
      const held = record;
      const ex = exchange;
      const entry: Active | undefined =
        ex === undefined ? undefined : { record: held, method, params };
      let stopAbort = (): void => undefined;
      try {
        if (ex !== undefined && entry !== undefined) {
          ex.active.add(entry);
          // The client went away: nothing the handler returns reaches it.
          stopAbort = onAbort([ex.request.signal], () => {
            ex.aborted = true;
            if (entry.message === undefined && ex.messages !== undefined) {
              const message = findMessage(ex, method, params);
              if (message !== undefined) link(ex, entry, message);
            }
            held.abandon();
          });
        }
      } catch (error) {
        inst.client.debug(`could not watch ${method} for cancellation`, error);
      }

      // The handler finished: stop the clock, claim the wire message (the
      // HTTP layer then leaves it to this record) and let the HTTP layer
      // settle the record from the reply the client receives. Without an
      // HTTP exchange, settle with the handler's outcome now. The body is
      // parsed long before a handler finishes; wait for it if it was not.
      const conclude = (provisional: () => void): void => {
        stopAbort();
        held.stopClock();
        if (ex === undefined || entry === undefined) {
          provisional();
          return;
        }
        const hold = (): void => {
          ex.active.delete(entry);
          if (entry.message === undefined && !ex.closed) {
            const message = findMessage(ex, method, params);
            if (message !== undefined) link(ex, entry, message);
          }
          // Already recorded: cancelled, or claimed by the HTTP layer when
          // the response ended before this handler did.
          if (held.finished) return;
          const message = entry.message;
          if (
            ex.aborted ||
            (message !== undefined && ex.cancelled.has(message))
          ) {
            held.abandon();
            return;
          }
          if (message === undefined) {
            provisional();
            return;
          }
          ex.held.set(message, { record: held, provisional });
        };
        if (ex.messages !== undefined || ex.closed) hold();
        else void ex.parsed.then(hold);
      };
      try {
        const result = await next();
        try {
          const key = LIST_RESULT_KEY[method];
          const value =
            key !== undefined && Array.isArray(result)
              ? { [key]: result }
              : result;
          conclude(() => held.succeed(value));
        } catch {
          // Recording never affects the response.
        }
        return result;
      } catch (error) {
        try {
          const toolError =
            method === "tools/call" ? asToolError(error) : undefined;
          conclude(() => {
            if (toolError !== undefined) held.succeed(toolError);
            else held.fail(error);
          });
        } catch {
          // Recording never affects the response.
        }
        throw error;
      }
    };

  try {
    for (const method of HOOKED_METHODS)
      server.use(`mcp:${method}`, middleware(method));
  } catch (error) {
    warnOncePerProcess(
      "mcp-use-started",
      `instrument() was called after the mcp-use server started; call it before listen() or the first request. (${
        error instanceof Error ? error.message : String(error)
      })`
    );
    return false;
  }

  /** Settle every held record without a reply and close the exchange. */
  const release = (exchange: Exchange, status: number | undefined): void => {
    exchange.closed = true;
    for (const [message, { record, provisional }] of exchange.held) {
      exchange.held.delete(message);
      if (exchange.aborted || exchange.cancelled.has(message)) {
        record.abandon();
      } else if (status !== undefined && status >= 400) {
        // The client got an HTTP error page instead of the handler's result.
        record.failHttp(status);
      } else {
        provisional();
      }
    }
    for (const stop of exchange.unwatch.splice(0)) stop();
  };

  /**
   * Read the reply the client received (from a clone, in the background):
   * settle the held middleware records and record every request no
   * middleware saw. Returns the reading, or undefined when there is none.
   */
  const finish = (
    exchange: Exchange,
    response: Response
  ): Promise<void> | undefined => {
    if (response.status === CLIENT_CLOSED_REQUEST) {
      // No HTTP response reached the client: record no status at all.
      exchange.aborted = true;
    } else {
      exchange.status = response.status;
      for (const record of exchange.records) {
        if (record.http !== undefined) record.http.status = response.status;
      }
    }
    const settled =
      exchange.messages !== undefined &&
      exchange.held.size === 0 &&
      exchange.messages.every((m) => exchange.claimed.has(m));
    if (settled) {
      release(exchange, response.status);
      return undefined;
    }
    const copy = response.body === null ? undefined : response.clone();
    return (async () => {
      const { answered } = exchange;
      try {
        await exchange.parsed;
        const messages = exchange.messages ?? [];
        const open = (): boolean =>
          messages.some(
            (m) =>
              !answered.has(m) &&
              (!exchange.claimed.has(m) || exchange.held.has(m))
          );
        if (copy !== undefined && messages.length > 0 && open()) {
          await readResponses(
            copy,
            (reply) => {
              const message = messages.find(
                (m) => m.id === reply.id && !answered.has(m)
              );
              if (message === undefined) return;
              const held = exchange.held.get(message);
              if (held !== undefined) {
                answered.add(message);
                exchange.held.delete(message);
                if (exchange.cancelled.has(message)) held.record.abandon();
                else held.record.respond(reply);
                return;
              }
              if (exchange.claimed.has(message)) return;
              answered.add(message);
              const entry = activeFor(exchange, message);
              if (entry !== undefined) link(exchange, entry, message);
              const record = entry?.record ?? recordFromWire(exchange, message);
              if (exchange.cancelled.has(message)) record?.abandon();
              else record?.respond(reply);
            },
            () => !open()
          );
        } else {
          await copy?.body?.cancel().catch(() => undefined);
        }
        // Requests whose response never showed up are still recorded: an
        // HTTP failure without a JSON-RPC reply (error page, middleware 5xx)
        // as an error without a JSON-RPC code, a client gone mid-stream
        // without an outcome. A handler still running owns its request.
        for (const message of messages) {
          if (exchange.claimed.has(message) || answered.has(message)) continue;
          const entry = activeFor(exchange, message);
          let record: RequestRecord | undefined;
          if (entry !== undefined) {
            link(exchange, entry, message);
            record = entry.record;
          } else {
            answered.add(message);
            record = recordFromWire(exchange, message);
          }
          if (record === undefined || record.finished) continue;
          if (exchange.aborted || exchange.cancelled.has(message))
            record.abandon();
          else if (response.status >= 400) record.failHttp(response.status);
          else record.abandon();
        }
      } finally {
        release(exchange, response.status);
      }
    })();
  };

  /** Keep a serverless invocation (and `flush()`) waiting for a response read. */
  const track = (reading: Promise<void>): void => {
    inst.client.track(reading);
    try {
      (inst.hooks.waitUntil ?? vercelWaitUntil())?.(reading);
    } catch (error) {
      inst.client.debug("waitUntil threw", error);
    }
  };

  /**
   * On a stateless exchange (no session, 2025-era): apply the
   * `notifications/cancelled` the body carries to the requests they name,
   * and let later ones cancel this body's requests (see cancel.ts).
   */
  const watchCancellations = (exchange: Exchange, body: unknown): void => {
    if (exchange.header("mcp-session-id") !== undefined) return;
    let scope: string | undefined;
    for (const item of Array.isArray(body) ? body : [body]) {
      const id = cancelledRequestId(item);
      if (id === undefined) continue;
      scope ??= requesterScope(exchange.header);
      cancelRequest(id, scope);
    }
    for (const message of exchange.messages ?? []) {
      const version = envelopeVersion(message.params);
      if (version !== undefined && version >= "2026") continue;
      scope ??= requesterScope(exchange.header);
      exchange.unwatch.push(
        watchCancellation(message.id, scope, () =>
          cancelMessage(exchange, message)
        )
      );
    }
  };

  server.use(async (c: HonoContextLike, next: () => Promise<void>) => {
    let exchange: Exchange | undefined;
    try {
      const request = c.req.raw;
      if (
        c.req.method.toUpperCase() === "POST" &&
        (c.req.path ?? pathname(request.url)) === basePath &&
        inst.client.active
      ) {
        const header = fetchHeaders(request.headers);
        const skip = header("x-gateway-request-id") !== undefined;
        let messages: JsonRpcRequestMessage[] | undefined;
        const parsed =
          skip || request.bodyUsed
            ? Promise.resolve()
            : request
                .clone()
                .json()
                .then(
                  (body: unknown) => {
                    messages = requestMessages(body);
                    if (exchange === undefined) return;
                    exchange.messages = messages;
                    try {
                      if (!exchange.closed) watchCancellations(exchange, body);
                    } catch (error) {
                      inst.client.debug(
                        "could not watch for cancellation",
                        error
                      );
                    }
                  },
                  () => undefined
                );
        exchange = {
          skip,
          request,
          header,
          startedAt: { wall: Date.now(), mono: monotonicNow() },
          messages,
          parsed,
          claimed: new Set(),
          active: new Set(),
          held: new Map(),
          answered: new Set(),
          cancelled: new Set(),
          unwatch: [],
          records: [],
          status: undefined,
          aborted: false,
          closed: false,
        };
        exchanges.set(request, exchange);
      }
    } catch (error) {
      inst.client.debug("could not inspect an MCP request", error);
      exchange = undefined;
    }
    let completed = false;
    try {
      await next();
      completed = true;
    } finally {
      if (exchange !== undefined && !exchange.skip) {
        if (!completed) {
          release(exchange, undefined);
        } else {
          try {
            const reading = finish(exchange, c.res)?.catch((error: unknown) =>
              inst.client.debug("could not read an MCP response", error)
            );
            if (reading !== undefined) track(reading);
          } catch (error) {
            inst.client.debug("could not inspect an MCP response", error);
            release(exchange, undefined);
          }
        }
      }
    }
  });
  return true;
}
