/**
 * One recorded JSON-RPC request. Adapters normalize what their framework
 * exposes into {@link RequestFacts}, call {@link Instrumentation.begin} before
 * the handler runs and complete the returned record once it settles. The hot
 * path only copies a few fields; hashing, payload redaction and the user's
 * hooks' promises are resolved at flush time in {@link RequestRecord.toWire}.
 */

import type { AnalyticsClient, EventSource, PendingEvent } from "./client.js";
import {
  bearerTokenOf,
  displayClaim,
  sha256Hex,
  tokenDisplayMetadata,
  tokenIdentityHash,
} from "./identity.js";
import { boundedPayload, redactValue } from "./redact.js";
import {
  monotonicNow,
  unrefTimeout,
  uuidv7,
  vercelWaitUntil,
} from "./runtime.js";
import { globalState } from "./state.js";
import type {
  ActorIdentity,
  AnalyticsActor,
  AnalyticsClientInfo,
  AnalyticsEvent,
  AnalyticsHttpInfo,
  AnalyticsOpenAiInfo,
  AnalyticsOptions,
  AnalyticsRequestContext,
  Outcome,
  RemoteConfig,
  Transport,
} from "./types.js";

const MAX_ERROR_MESSAGE = 500;
const MAX_CLIENT_INFO_CHARS = 10_000;

/**
 * Per-field limits of the ingest edge (`SdkEventSchema`), the same as the
 * Python SDK's `_extract.LIMITS`. The edge rejects a whole event when one
 * field is longer, so values are clipped here instead.
 */
const LIMITS = {
  method: 200,
  requestId: 200,
  target: 4096,
  sessionId: 512,
  conversationId: 512,
  client: 256,
  protocolVersion: 64,
  httpMethod: 16,
  httpPath: 2048,
  httpHost: 260,
  userAgent: 4096,
  origin: 2048,
  referer: 4096,
  openai: 512,
  traceId: 64,
} as const;

/** JSON-RPC error codes are int32 on the edge; other numbers are left out. */
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/**
 * Longest wait for an async `identify`, `conversationId` or `redact` hook. A
 * hook that has not settled by then is skipped (the default identity, no
 * conversation id) or, for `redact`, drops the event, so a hung hook never
 * holds delivery or `flush()`.
 */
const HOOK_TIMEOUT_MS = 2_000;

/** Platform headers carrying the client's ISO country, in order of preference. */
const COUNTRY_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
] as const;

/** Reads one request header, case-insensitively. */
export type HeaderReader = (name: string) => string | undefined;

/** A header reader for requests without HTTP (stdio, in-memory). */
export const NO_HEADERS: HeaderReader = () => undefined;

/** What an adapter knows about a request before its handler runs. */
export interface RequestFacts {
  /** Exact JSON-RPC method. */
  method: string;
  /** JSON-RPC id. */
  requestId?: string | number;
  /** Params as the handler receives them. */
  params?: Record<string, unknown>;
  /** `_meta`, including envelope keys the SDK lifted out of params. */
  meta?: Record<string, unknown>;
  /** Transport session id. */
  sessionId?: string;
  /** Request headers (`NO_HEADERS` without HTTP). */
  header: HeaderReader;
  /** Request URL, when it arrived over HTTP. */
  url?: string;
  /** HTTP method, when known. */
  httpMethod?: string;
  /** Verified auth info attached by the framework. */
  authInfo?: Record<string, unknown>;
  /** Transport kind, when known. */
  transport?: Transport;
  /** Whether the HTTP transport is stateless. */
  stateless?: boolean;
  /** Protocol version of this request. */
  protocolVersion?: string;
  /** Best known client identity. */
  client?: AnalyticsClientInfo;
  /** The framework's own context, handed to user hooks as `raw`. */
  raw: unknown;
}

/**
 * Outcome of a handler: a result value, a thrown error, an HTTP failure
 * without a JSON-RPC reply, or none (the client never received a reply).
 */
type Settlement =
  | { kind: "result"; value: unknown }
  | { kind: "error"; value: unknown }
  | { kind: "http"; status: number }
  | { kind: "none" };

/** The JSON-RPC response as it reached the wire, for HTTP-level adapters. */
export interface JsonRpcResponseMessage {
  /** Present on success. */
  result?: unknown;
  /** Present on a JSON-RPC error. */
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

/** Options that apply per `instrument()` call. */
type HookOptions = Pick<
  AnalyticsOptions,
  "capturePayloads" | "redact" | "identify" | "conversationId" | "waitUntil"
>;

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Cut to `max` UTF-16 code units (what the edge counts), never splitting a
 * surrogate pair.
 */
function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  const last = value.charCodeAt(max - 1);
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** A non-empty trimmed string of at most `max` characters, else undefined. */
function clip(value: unknown, max: number): string | undefined {
  const s = str(value);
  return s === undefined ? undefined : cut(s, max);
}

/** Tool name, resource URI or prompt name, like the gateway's `resource_name`. */
function targetOf(
  method: string,
  params: Record<string, unknown> | undefined
): string | undefined {
  if (params === undefined) return undefined;
  if (method === "tools/call" || method === "prompts/get") {
    return clip(params["name"], LIMITS.target);
  }
  if (method === "resources/read") return clip(params["uri"], LIMITS.target);
  return undefined;
}

/** Joined text content of an `isError` tool result, like the gateway. */
function toolErrorText(result: unknown): string | undefined {
  if (!isRecord(result) || !Array.isArray(result["content"])) return undefined;
  const text = (result["content"] as unknown[])
    .map((item) =>
      isRecord(item) && item["type"] === "text"
        ? String(item["text"] ?? "")
        : ""
    )
    .filter(Boolean)
    .join("\n");
  return text.length > 0 ? text : undefined;
}

function errorFields(error: unknown): { code?: number; message: string } {
  const record = isRecord(error) ? error : undefined;
  const code = record?.["code"];
  const message =
    error instanceof Error
      ? error.message
      : typeof record?.["message"] === "string"
        ? record["message"]
        : typeof error === "string"
          ? error
          : undefined;
  return {
    // Same normalization as the SDKs use to build the JSON-RPC error. A
    // numeric code outside int32 (an HRESULT, say) is left out: the edge
    // would reject the whole event.
    ...(typeof code !== "number"
      ? { code: -32603 }
      : Number.isInteger(code) && code >= INT32_MIN && code <= INT32_MAX
        ? { code }
        : {}),
    message: cut(message || "Internal error", MAX_ERROR_MESSAGE),
  };
}

/**
 * Trace id of the first W3C `traceparent` that has one (`_meta` first, then
 * the header), lowercased. Longer than 64 hex characters is not a trace id.
 */
function traceIdOf(
  ...traceparents: Array<string | undefined>
): string | undefined {
  for (const traceparent of traceparents) {
    if (traceparent === undefined) continue;
    const id = traceparent.trim().split("-")[1];
    if (
      id !== undefined &&
      id.length > 0 &&
      id.length <= LIMITS.traceId &&
      /^[0-9a-f]+$/i.test(id)
    ) {
      return id.toLowerCase();
    }
  }
  return undefined;
}

function countryCode(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  return code !== undefined && /^[A-Z]{2}$/.test(code) && code !== "XX"
    ? code
    : undefined;
}

/** Drop undefined fields; undefined when nothing is left. */
function compact<T extends Record<string, unknown>>(
  value: T
): { [K in keyof T]?: Exclude<T[K], undefined> } | undefined {
  const out: Record<string, unknown> = {};
  let empty = true;
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue;
    out[key] = field;
    empty = false;
  }
  return empty
    ? undefined
    : (out as { [K in keyof T]?: Exclude<T[K], undefined> });
}

function openAiInfo(
  meta: Record<string, unknown> | undefined,
  header: HeaderReader
): AnalyticsOpenAiInfo | undefined {
  const location = meta?.["openai/userLocation"];
  const limit = LIMITS.openai;
  return compact({
    session:
      clip(meta?.["openai/session"], limit) ??
      clip(header("x-openai-session"), limit),
    subject:
      clip(meta?.["openai/subject"], limit) ??
      clip(header("x-openai-subject"), limit),
    organization: clip(meta?.["openai/organization"], limit),
    country: isRecord(location)
      ? countryCode(str(location["country"]))
      : undefined,
  });
}

/**
 * The client-facing host: the first entry of a multi-value
 * `X-Forwarded-Host` (chained proxies append theirs), else `Host`, else the
 * request URL's host.
 */
function hostOf(
  header: HeaderReader,
  urlHost: string | undefined
): string | undefined {
  const raw =
    str(header("x-forwarded-host")) ?? str(header("host")) ?? urlHost ?? "";
  return clip(raw.split(",")[0], LIMITS.httpHost);
}

function httpInfo(facts: RequestFacts): AnalyticsHttpInfo | undefined {
  if (facts.url === undefined && facts.header("host") === undefined) {
    return undefined;
  }
  let path: string | undefined;
  let urlHost: string | undefined;
  if (facts.url !== undefined) {
    try {
      const url = new URL(facts.url);
      path = url.pathname;
      urlHost = url.host;
    } catch {
      path = undefined;
    }
  }
  let country: string | undefined;
  for (const name of COUNTRY_HEADERS) {
    country = countryCode(facts.header(name));
    if (country !== undefined) break;
  }
  return compact({
    method: clip(facts.httpMethod, LIMITS.httpMethod),
    path: clip(path, LIMITS.httpPath),
    host: hostOf(facts.header, urlHost),
    user_agent: clip(facts.header("user-agent"), LIMITS.userAgent),
    origin: clip(facts.header("origin"), LIMITS.origin),
    referer: clip(facts.header("referer"), LIMITS.referer),
    country,
  });
}

/** What a hook promise came to: its value, or why there is none. */
type HookOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "threw" | "timeout"; error?: unknown };

/**
 * Settle a hook's return value within {@link HOOK_TIMEOUT_MS}. Synchronous
 * values resolve at once; only a promise arms a (non-blocking) timer.
 */
function boundHook<T>(value: T | PromiseLike<T>): Promise<HookOutcome<T>> {
  if (!isThenable(value)) {
    return Promise.resolve({ ok: true, value: value as T });
  }
  return new Promise((resolve) => {
    const timer = unrefTimeout(
      () => resolve({ ok: false, reason: "timeout" }),
      HOOK_TIMEOUT_MS
    );
    Promise.resolve(value).then(
      (settled) => {
        clearTimeout(timer);
        resolve({ ok: true, value: settled });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: "threw", error });
      }
    );
  });
}

function requestContext(
  record: RequestRecord,
  facts: RequestFacts,
  settlement: Settlement
): AnalyticsRequestContext {
  const header = facts.header;
  return {
    method: facts.method,
    ...(facts.requestId !== undefined && { requestId: facts.requestId }),
    ...(facts.params !== undefined && { params: facts.params }),
    ...(facts.sessionId !== undefined && { sessionId: facts.sessionId }),
    ...(facts.authInfo !== undefined && { authInfo: facts.authInfo }),
    framework: record.source.framework,
    raw: facts.raw,
    ...(settlement.kind === "result"
      ? { result: settlement.value }
      : settlement.kind === "error"
        ? { error: settlement.value }
        : settlement.kind === "http"
          ? { error: { message: `HTTP ${settlement.status}` } }
          : {}),
    // Bound now: the record releases its header reader once the hooks ran,
    // and an async hook may read headers later.
    header: (name: string) => header(name.toLowerCase()),
  };
}

/**
 * Per-`instrument()` state shared by every request of one server: the
 * delivery client, the batch source and the user's hooks.
 */
export class Instrumentation {
  /** Shared delivery client for the key. */
  readonly client: AnalyticsClient;
  /** Batch grouping for this server's events. */
  readonly source: EventSource;
  /** The user's per-server hooks and capture option. */
  readonly hooks: HookOptions;

  /** Bind a server's hooks to a delivery client. */
  constructor(
    client: AnalyticsClient,
    source: EventSource,
    hooks: HookOptions
  ) {
    this.client = client;
    this.source = source;
    this.hooks = hooks;
  }

  /**
   * Start recording a request, or return undefined when it must not be
   * recorded: recording is off, the gateway already records it, or an outer
   * wrapper is recording the same request.
   *
   * @param guardKeys - Objects identifying this request (the JSON-RPC message,
   * the framework context). A request any key was seen with is recorded once.
   */
  begin(
    facts: RequestFacts,
    guardKeys: readonly unknown[],
    startedAt?: { wall: number; mono: number }
  ): RequestRecord | undefined {
    if (!this.client.active) return undefined;
    const guard = globalState().inFlight;
    for (const key of guardKeys) {
      if (typeof key === "object" && key !== null && guard.has(key)) {
        return undefined;
      }
    }
    for (const key of guardKeys) {
      if (typeof key === "object" && key !== null) guard.add(key);
    }
    if (facts.header("x-gateway-request-id") !== undefined) return undefined;
    return new RequestRecord(this, facts, startedAt);
  }
}

/** A request being recorded; becomes a {@link PendingEvent} once it settles. */
export class RequestRecord implements PendingEvent {
  /** Batch grouping, shared with the instrumentation. */
  readonly source: EventSource;
  readonly #inst: Instrumentation;
  readonly #facts: RequestFacts;
  readonly #id: string;
  readonly #startedAt: number;
  readonly #start: number;
  #target: string | undefined;
  readonly #http: AnalyticsHttpInfo | undefined;
  readonly #openai: AnalyticsOpenAiInfo | undefined;
  readonly #traceId: string | undefined;
  readonly #token: string | undefined;
  #done = false;
  #clockStopped = false;
  /** No JSON-RPC response reached the client (an HTTP-level failure). */
  #noResponse = false;
  #durationMs = 0;
  #outcome: Outcome | undefined = "success";
  #error: AnalyticsEvent["error"];
  #result: unknown;
  #rpcError: { code?: number; message: string } | undefined;
  #identity: Promise<HookOutcome<ActorIdentity | null | undefined>> | undefined;
  #conversation: Promise<HookOutcome<string | null | undefined>> | undefined;
  #tokenHash: Promise<string | undefined> | undefined;
  #display: { name?: string; email?: string } | undefined;

  /** Start recording now, or at `startedAt` when an HTTP layer saw the request first. */
  constructor(
    inst: Instrumentation,
    facts: RequestFacts,
    startedAt?: { wall: number; mono: number }
  ) {
    this.#inst = inst;
    this.source = inst.source;
    this.#facts = facts;
    this.#startedAt = startedAt?.wall ?? Date.now();
    this.#start = startedAt?.mono ?? monotonicNow();
    this.#id = uuidv7(this.#startedAt);
    this.#target = targetOf(facts.method, facts.params);
    this.#http = httpInfo(facts);
    this.#openai = openAiInfo(facts.meta, facts.header);
    const metaTraceparent = facts.meta?.["traceparent"];
    this.#traceId = traceIdOf(
      typeof metaTraceparent === "string" ? metaTraceparent : undefined,
      facts.header("traceparent")
    );
    this.#token = bearerTokenOf(
      facts.header("authorization"),
      facts.authInfo?.["token"]
    );
  }

  /** HTTP facts; adapters that see the HTTP response set `status` on it. */
  get http(): AnalyticsHttpInfo | undefined {
    return this.#http;
  }

  /** Whether the request was settled (or abandoned) and queued. */
  get finished(): boolean {
    return this.#done;
  }

  /**
   * Adopt the JSON-RPC id and target of the wire message an HTTP-level
   * adapter matched to this request (the framework may have normalized the
   * params it handed the handler, such as a resource URI), and its protocol
   * version when the handler's params did not carry one.
   */
  matchWire(
    id: string | number,
    params: Record<string, unknown> | undefined,
    protocolVersion?: string
  ): void {
    this.#facts.requestId = id;
    this.#target = targetOf(this.#facts.method, params) ?? this.#target;
    if (protocolVersion !== undefined)
      this.#facts.protocolVersion ??= protocolVersion;
  }

  /**
   * Freeze the duration now (the handler finished) when the outcome is
   * settled later, from the reply the client received.
   */
  stopClock(): void {
    if (this.#done || this.#clockStopped) return;
    this.#durationMs = Math.max(0, monotonicNow() - this.#start);
    this.#clockStopped = true;
  }

  /** Record the handler's return value. Never throws. */
  succeed(result: unknown): void {
    this.#settle({ kind: "result", value: result });
  }

  /** Record a thrown error (the caller rethrows it). Never throws. */
  fail(error: unknown): void {
    this.#settle({ kind: "error", value: error });
  }

  /** Record the JSON-RPC response read from the wire. Never throws. */
  respond(message: JsonRpcResponseMessage): void {
    if (message.error !== undefined) {
      this.#settle({ kind: "error", value: message.error });
    } else {
      this.#settle({ kind: "result", value: message.result });
    }
  }

  /**
   * Record an HTTP failure that carried no JSON-RPC reply (an error page, a
   * middleware's 5xx): an error without a JSON-RPC code, like the gateway's
   * own transport errors. Never throws.
   */
  failHttp(status: number): void {
    this.#settle({ kind: "http", status });
  }

  /**
   * Record a request whose reply never reached the client (the client
   * cancelled it or went away mid-stream): the event is sent without an
   * outcome and without a response, and a later result is ignored. Never
   * throws.
   */
  abandon(): void {
    if (this.#done) return;
    this.#done = true;
    this.#outcome = undefined;
    this.#noResponse = true;
    try {
      if (!this.#clockStopped) {
        this.#durationMs = Math.max(0, monotonicNow() - this.#start);
      }
      this.#runHooks({ kind: "none" });
      this.#release();
      this.#inst.client.enqueue(
        this,
        this.#inst.hooks.waitUntil ?? vercelWaitUntil()
      );
    } catch (error) {
      this.#inst.client.debug("failed to record a request", error);
    }
  }

  #settle(settlement: Exclude<Settlement, { kind: "none" }>): void {
    if (this.#done) return;
    this.#done = true;
    try {
      if (!this.#clockStopped) {
        this.#durationMs = Math.max(0, monotonicNow() - this.#start);
      }
      const method = this.#facts.method;
      if (settlement.kind === "http") {
        this.#outcome = "error";
        this.#error = { message: `HTTP ${settlement.status}` };
        this.#noResponse = true;
      } else if (settlement.kind === "error") {
        this.#outcome = "error";
        this.#rpcError = errorFields(settlement.value);
        this.#error = this.#rpcError;
      } else {
        this.#result = settlement.value;
        this.#learnServerInfo(settlement.value);
        if (
          method === "tools/call" &&
          isRecord(settlement.value) &&
          settlement.value["isError"] === true
        ) {
          this.#outcome = "tool_error";
          const text = toolErrorText(settlement.value);
          this.#error =
            text === undefined ? {} : { message: cut(text, MAX_ERROR_MESSAGE) };
        }
      }
      this.#runHooks(settlement);
      this.#release();
      const waitUntil = this.#inst.hooks.waitUntil ?? vercelWaitUntil();
      this.#inst.client.enqueue(this, waitUntil);
    } catch (error) {
      this.#inst.client.debug("failed to record a request", error);
    }
  }

  /**
   * Drop references to the framework's request objects (headers, the HTTP
   * request, the handler context) once the hooks ran; only plain facts wait
   * in the queue.
   */
  #release(): void {
    this.#facts.header = NO_HEADERS;
    this.#facts.raw = undefined;
    delete this.#facts.authInfo;
  }

  /** Fill the batch's `server` from a result when the adapter could not read it. */
  #learnServerInfo(result: unknown): void {
    if (this.source.server !== undefined || !isRecord(result)) return;
    // `initialize` and `server/discover` results carry it; 2026-era results
    // may also stamp it into `_meta`.
    const meta = isRecord(result["_meta"]) ? result["_meta"] : undefined;
    const info =
      result["serverInfo"] ?? meta?.["io.modelcontextprotocol/serverInfo"];
    if (!isRecord(info)) return;
    const name = str(info["name"]);
    const version = str(info["version"]);
    if (name === undefined && version === undefined) return;
    this.source.server = {
      ...(name !== undefined && { name }),
      ...(version !== undefined && { version }),
    };
  }

  #runHooks(settlement: Settlement): void {
    const { identify, conversationId } = this.#inst.hooks;
    const client = this.#inst.client;
    if (identify !== undefined || conversationId !== undefined) {
      const ctx = requestContext(this, this.#facts, settlement);
      if (identify !== undefined) {
        try {
          this.#identity = boundHook(identify(ctx));
        } catch (error) {
          client.debug("identify() threw", error);
        }
      }
      if (conversationId !== undefined) {
        try {
          this.#conversation = boundHook(conversationId(ctx));
        } catch (error) {
          client.debug("conversationId() threw", error);
        }
      }
    }
    if (this.#token !== undefined) {
      this.#tokenHash = tokenIdentityHash(this.#token).catch(() => undefined);
      // Kept whatever the dashboard setting is now: toWire() drops them
      // unless "identify actors" is on by then, and it may be turned on in
      // between.
      this.#display = tokenDisplayMetadata(this.#token);
    }
  }

  /** A hook's value, or undefined (the default) when it threw or timed out. */
  async #hookValue<T>(
    name: string,
    outcome: Promise<HookOutcome<T>> | undefined
  ): Promise<T | undefined> {
    if (outcome === undefined) return undefined;
    const settled = await outcome;
    if (settled.ok) return settled.value;
    this.#inst.client.debug(
      settled.reason === "timeout"
        ? `${name} did not settle within ${HOOK_TIMEOUT_MS}ms; using the default`
        : `${name} threw`,
      settled.error
    );
    return undefined;
  }

  async #actor(config: RemoteConfig): Promise<AnalyticsActor | undefined> {
    const identity = await this.#hookValue("identify()", this.#identity);
    if (identity === null) return undefined;
    const id = identity?.id === undefined ? undefined : str(identity.id);
    const tokenHash =
      id !== undefined
        ? await sha256Hex(id)
        : this.#tokenHash === undefined
          ? undefined
          : await this.#tokenHash;
    // The edge keeps an actor's name and email only next to its token_hash, so
    // without one (no `id` from identify() and no Bearer token) no actor is
    // sent at all, the same as in the Python SDK.
    if (tokenHash === undefined) return undefined;
    const name = displayClaim(identity?.name, 256) ?? this.#display?.name;
    const email = displayClaim(identity?.email, 320) ?? this.#display?.email;
    return compact({
      token_hash: tokenHash,
      name: config.identify_actors ? name : undefined,
      email: config.identify_actors ? email : undefined,
    });
  }

  #requestMessage(): Record<string, unknown> {
    const { requestId, method, params } = this.#facts;
    return {
      jsonrpc: "2.0",
      ...(requestId !== undefined && { id: requestId }),
      method,
      ...(params !== undefined && { params }),
    };
  }

  #responseMessage(): Record<string, unknown> | undefined {
    if (this.#noResponse) return undefined;
    const { requestId } = this.#facts;
    return {
      jsonrpc: "2.0",
      ...(requestId !== undefined && { id: requestId }),
      ...(this.#rpcError !== undefined
        ? { error: this.#rpcError }
        : { result: this.#result ?? {} }),
    };
  }

  /** Build the wire event at flush time. */
  async toWire(config: RemoteConfig): Promise<AnalyticsEvent | null> {
    const facts = this.#facts;
    const conversation = await this.#hookValue(
      "conversationId()",
      this.#conversation
    );
    const actor = await this.#actor(config);
    const capture =
      config.capture_payloads && this.#inst.hooks.capturePayloads !== false;

    const request = this.#requestMessage();
    const response = this.#responseMessage();
    const requestSize = safeLength(request);
    const responseSize =
      response === undefined ? undefined : safeLength(response);

    let clientInfo: unknown;
    if (facts.method === "initialize" && isRecord(facts.params)) {
      const raw = facts.params["clientInfo"];
      if (raw !== undefined) {
        const copy = redactValue(raw);
        // The edge takes an object only; anything else would reject the event.
        clientInfo =
          isRecord(copy) && (safeLength(copy) ?? 0) <= MAX_CLIENT_INFO_CHARS
            ? copy
            : undefined;
      }
    }

    const client =
      facts.client === undefined
        ? undefined
        : compact({
            name: clip(facts.client.name, LIMITS.client),
            version: clip(facts.client.version, LIMITS.client),
          });
    const requestId =
      typeof facts.requestId === "string"
        ? cut(facts.requestId, LIMITS.requestId)
        : facts.requestId;
    const sessionId = clip(facts.sessionId, LIMITS.sessionId);
    const conversationId =
      typeof conversation === "string"
        ? clip(conversation, LIMITS.conversationId)
        : undefined;
    const protocolVersion = clip(facts.protocolVersion, LIMITS.protocolVersion);
    const event: AnalyticsEvent = {
      id: this.#id,
      time: new Date(this.#startedAt).toISOString(),
      duration_ms: Math.round(this.#durationMs * 1000) / 1000,
      method: cut(facts.method, LIMITS.method),
      ...(requestId !== undefined && { request_id: requestId }),
      ...(this.#target !== undefined && { target: this.#target }),
      ...(this.#outcome !== undefined && { outcome: this.#outcome }),
      ...(this.#error !== undefined && { error: this.#error }),
      ...(sessionId !== undefined && { session_id: sessionId }),
      ...(conversationId !== undefined && { conversation_id: conversationId }),
      ...(client !== undefined && { client }),
      ...(clientInfo !== undefined && { client_info: clientInfo }),
      ...(protocolVersion !== undefined && {
        protocol_version: protocolVersion,
      }),
      ...(facts.transport !== undefined && { transport: facts.transport }),
      ...(facts.stateless !== undefined && { stateless: facts.stateless }),
      ...(this.#http !== undefined && { http: { ...this.#http } }),
      ...(actor !== undefined && { actor }),
      ...(this.#openai !== undefined && { openai: this.#openai }),
      ...(this.#traceId !== undefined && { trace_id: this.#traceId }),
      ...(requestSize !== undefined && { request_size: requestSize }),
      ...(responseSize !== undefined && { response_size: responseSize }),
      ...(capture && { request_payload: boundedPayload(request) }),
      ...(capture &&
        response !== undefined && {
          response_payload: boundedPayload(response),
        }),
    };
    // Release references to the request and result as soon as possible.
    this.#result = undefined;

    const redact = this.#inst.hooks.redact;
    if (redact === undefined) return event;
    let outcome: HookOutcome<AnalyticsEvent | null | undefined>;
    try {
      outcome = await boundHook(redact(event));
    } catch (error) {
      outcome = { ok: false, reason: "threw", error };
    }
    if (!outcome.ok) {
      this.#inst.client.debug(
        outcome.reason === "timeout"
          ? `redact() did not settle within ${HOOK_TIMEOUT_MS}ms; dropping the event`
          : "redact() threw; dropping the event",
        outcome.error
      );
      return null;
    }
    if (outcome.value === null) return null;
    return outcome.value ?? event;
  }
}

function safeLength(value: unknown): number | undefined {
  try {
    return JSON.stringify(value)?.length;
  } catch {
    return undefined;
  }
}
