/**
 * The runner's harness: request envelopes per profile and era, the cached
 * `events/list`, event selection, error-code expectations and helpers shared
 * by the checks.
 *
 * @packageDocumentation
 */

import { EVENTS_ERROR_CODES, type EventsErrorKind } from "../codes.js";
import { PRESETS } from "../presets.js";
import { generateWebhookSecret } from "../secrets.js";
import {
  EVENTS_EXTENSION_ID,
  EVENTS_METHODS,
  type DeliveryMode,
  type EventDescriptor,
} from "../wire.js";
import {
  encodeHeaderValue,
  MCP_METHOD_HEADER,
  MCP_NAME_HEADER,
  paramHeadersFor,
} from "../x-mcp-header.js";
import { readExchange, type RpcExchange } from "./http.js";
import type {
  ConformanceProfile,
  Harness,
  ReceivedDelivery,
  ReceiverHandle,
} from "./types.js";

/** Protocol version of the modern era. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";
/** Protocol version the runner offers on a legacy `initialize`. */
export const LEGACY_PROTOCOL_VERSION = "2025-11-25";

// TODO(events): confirm these per-request envelope keys against the SDK 2.x modern codec once WP-23 lands.
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

/** Timing budgets of a run; tests shrink them. */
export interface Timing {
  /** Per request. */
  requestMs: number;
  /** How long to wait for an event to occur. */
  eventWaitMs: number;
  /** How long to wait for a delivery that should not come. */
  quietMs: number;
  /** Longest a stream check observes a stream. */
  streamObserveMs: number;
  /** Heartbeat interval requested on `events/stream`. */
  heartbeatRequestMs: number;
}

/** Default timing for real servers. */
export const DEFAULT_TIMING: Timing = {
  requestMs: 15_000,
  eventWaitMs: 20_000,
  quietMs: 2_000,
  streamObserveMs: 40_000,
  heartbeatRequestMs: 5_000,
};

/** Options of one exchange. */
export interface CallInit {
  /** `legacy` uses the `initialize` session; default `modern`. */
  era?: "legacy" | "modern";
  /** Extra headers, applied last. */
  headers?: Record<string, string>;
  /** `false` omits the bearer token (signed-out request). */
  auth?: boolean;
  /** `Mcp-Name` override: a string sends it, `null` omits it, absent follows the profile. */
  mcpName?: string | null;
  /** `false` omits the `Mcp-Param-*` headers the profile would send. */
  paramHeaders?: boolean;
}

/** The internal harness a check receives. */
export interface Ctx extends Harness {
  /** `lenient` or `strict`. */
  mcpName: "lenient" | "strict";
  /** Timing budgets. */
  timing: Timing;
  /** The fetch implementation of the run. */
  fetch: typeof fetch;
  /** Whether a bearer token is configured. */
  hasAuth: boolean;
  /** One request and its response. */
  call(method: string, params: unknown, init?: CallInit): Promise<RpcExchange>;
  /** One request, raw response (streams). */
  send(
    method: string,
    params: unknown,
    init?: CallInit & { id?: string | number; signal?: AbortSignal }
  ): Promise<{ id: string | number; res: Response }>;
  /** The capabilities of a handshake for this profile (cached), or `undefined` when the era is not served. */
  capabilities(
    era: "legacy" | "modern"
  ): Promise<Record<string, unknown> | undefined>;
  /** Whether the server advertises Events to this profile. */
  advertised(): Promise<boolean>;
  /** Every event descriptor (all pages, cached). */
  events(): Promise<EventDescriptor[]>;
  /** The first event offering `mode`, if any. */
  pickEvent(mode: DeliveryMode): Promise<EventDescriptor | undefined>;
  /** Fresh unique callback URL on the receiver plus its tag. */
  callback(): { url: string; tag: string };
  /** Run state shared between checks (observed events). */
  observed: Array<{ name: string; event: Record<string, unknown> }>;
}

let idCounter = 0;
/** A fresh JSON-RPC id. */
export function nextId(): string {
  idCounter += 1;
  return `conformance-${idCounter}`;
}

/** The emulated client for each profile. */
export function clientInfoFor(dialect: ConformanceProfile): {
  name: string;
  version: string;
} {
  return dialect === "openai"
    ? { name: "openai-mcp/1.0", version: "1.0.0" }
    : { name: "mcp-use-conformance", version: "1.0.0" };
}

const NAMED_METHODS: ReadonlySet<string> = new Set([
  EVENTS_METHODS.subscribe,
  EVENTS_METHODS.unsubscribe,
  EVENTS_METHODS.poll,
  EVENTS_METHODS.stream,
]);

/** Options to build a harness. */
export interface CtxOptions {
  url: URL;
  dialect: ConformanceProfile;
  fetch: typeof fetch;
  headers: Record<string, string>;
  bearer?: string;
  mcpName: "lenient" | "strict";
  receiver: ReceiverHandle;
  timing: Timing;
}

/** Header carrying the callback tag when the runner's own receiver recorded the delivery. */
export const CALLBACK_TAG_HEADER = "x-conformance-callback";

/** A predicate matching deliveries sent to the tagged callback (any delivery on a foreign receiver). */
export function forTag(tag: string): (d: ReceivedDelivery) => boolean {
  return (d) => {
    const t = d.headers.get(CALLBACK_TAG_HEADER);
    return t === null || t === tag;
  };
}

/** Builds the harness for one profile. */
export function createCtx(o: CtxOptions): Ctx {
  const caps = new Map<string, Promise<Record<string, unknown> | undefined>>();
  let legacySession: Promise<string | undefined> | undefined;
  let eventsCache: Promise<EventDescriptor[]> | undefined;
  const info = clientInfoFor(o.dialect);
  const sep = o.dialect === "sep-3415";

  const descriptorFor = async (
    name: unknown
  ): Promise<EventDescriptor | undefined> => {
    if (!eventsCache || typeof name !== "string") return undefined;
    return (await eventsCache).find((e) => e.name === name);
  };

  const buildHeaders = async (
    method: string,
    params: unknown,
    init: CallInit
  ): Promise<Headers> => {
    const h = new Headers(o.headers);
    h.set("content-type", "application/json");
    h.set("accept", "application/json, text/event-stream");
    if (o.bearer && init.auth !== false) {
      h.set("authorization", `Bearer ${o.bearer}`);
    }
    const era = init.era ?? "modern";
    if (era === "modern") {
      h.set("mcp-protocol-version", MODERN_PROTOCOL_VERSION);
      if (sep) h.set(MCP_METHOD_HEADER, method);
      const p = (params ?? {}) as Record<string, unknown>;
      if (NAMED_METHODS.has(method)) {
        if (init.mcpName !== undefined) {
          if (init.mcpName !== null) h.set(MCP_NAME_HEADER, init.mcpName);
        } else if (sep && typeof p.name === "string") {
          h.set(MCP_NAME_HEADER, encodeHeaderValue(p.name));
        }
        if (sep && init.paramHeaders !== false) {
          const d = await descriptorFor(p.name);
          if (d) {
            const args = (p.arguments ?? {}) as Record<string, unknown>;
            for (const [k, v] of Object.entries(paramHeadersFor(d, args))) {
              h.set(k, v);
            }
          }
        }
      }
    } else if (
      method !== "initialize" &&
      method !== "notifications/initialized"
    ) {
      h.set("mcp-protocol-version", LEGACY_PROTOCOL_VERSION);
      const sid = await legacySessionId();
      if (sid) h.set("mcp-session-id", sid);
    }
    for (const [k, v] of Object.entries(init.headers ?? {})) h.set(k, v);
    return h;
  };

  const envelope = (
    method: string,
    params: unknown,
    era: "legacy" | "modern"
  ): unknown => {
    const p = { ...((params ?? {}) as Record<string, unknown>) };
    if (era === "legacy") return p;
    const meta = { ...((p._meta ?? {}) as Record<string, unknown>) };
    meta[META_PROTOCOL_VERSION] = MODERN_PROTOCOL_VERSION;
    meta[META_CLIENT_INFO] = info;
    meta[META_CLIENT_CAPABILITIES] = sep
      ? { extensions: { [EVENTS_EXTENSION_ID]: {} } }
      : {};
    p._meta = meta;
    void method;
    return p;
  };

  const send: Ctx["send"] = async (method, params, init = {}) => {
    const id = init.id ?? nextId();
    const era = init.era ?? "modern";
    const headers = await buildHeaders(method, params, init);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: envelope(method, params, era),
    });
    const res = await o.fetch(o.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.any([
        AbortSignal.timeout(
          method === EVENTS_METHODS.stream
            ? o.timing.streamObserveMs + o.timing.requestMs
            : o.timing.requestMs
        ),
        ...(init.signal ? [init.signal] : []),
      ]),
    });
    return { id, res };
  };

  const call: Ctx["call"] = async (method, params, init = {}) => {
    const { id, res } = await send(method, params, init);
    return readExchange(res, id);
  };

  function legacySessionId(): Promise<string | undefined> {
    legacySession ??= (async (): Promise<string | undefined> => {
      const x = await call(
        "initialize",
        {
          protocolVersion: LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: info,
        },
        { era: "legacy" }
      );
      caps.set(
        "legacy",
        Promise.resolve(
          (x.response?.result?.capabilities as Record<string, unknown>) ??
            undefined
        )
      );
      const sid = x.headers.get("mcp-session-id") ?? undefined;
      if (x.response?.result) {
        const h = await buildHeaders(
          "notifications/initialized",
          {},
          { era: "legacy" }
        );
        if (sid) h.set("mcp-session-id", sid);
        await o
          .fetch(o.url, {
            method: "POST",
            headers: h,
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/initialized",
            }),
          })
          .then((r) => r.body?.cancel())
          .catch(() => undefined);
      }
      return sid;
    })().catch(() => {
      caps.set("legacy", Promise.resolve(undefined));
      return undefined;
    });
    return legacySession;
  }

  const capabilities: Ctx["capabilities"] = async (era) => {
    if (era === "legacy") {
      await legacySessionId();
      return caps.get("legacy") ?? Promise.resolve(undefined);
    }
    let c = caps.get("modern");
    if (!c) {
      c = call("server/discover", {}).then(
        (x) =>
          (x.response?.result?.capabilities as Record<string, unknown>) ??
          undefined,
        () => undefined
      );
      caps.set("modern", c);
    }
    return c;
  };

  const advertised: Ctx["advertised"] = async () => {
    const c = await capabilities("modern");
    if (!c) return false;
    if (sep) {
      const ext = c.extensions as Record<string, unknown> | undefined;
      return ext?.[EVENTS_EXTENSION_ID] !== undefined;
    }
    return c.events !== undefined;
  };

  const events: Ctx["events"] = () => {
    eventsCache ??= (async () => {
      const all: EventDescriptor[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const x = await call(
          EVENTS_METHODS.list,
          cursor === undefined ? {} : { cursor }
        );
        const r = x.response?.result;
        if (!r) throw new Error(`events/list failed: HTTP ${x.status}`);
        all.push(...((r.events as EventDescriptor[]) ?? []));
        const next = r.nextCursor;
        if (typeof next !== "string" || seen.has(next)) break;
        seen.add(next);
        cursor = next;
      }
      return all;
    })();
    return eventsCache;
  };

  let tagCounter = 0;
  return {
    url: o.url,
    dialect: o.dialect,
    receiver: o.receiver,
    mcpName: o.mcpName,
    timing: o.timing,
    hasAuth: o.bearer !== undefined,
    fetch: o.fetch,
    observed: [],
    rpc: async (method, params, init) =>
      (
        await send(
          method,
          params,
          init?.headers ? { headers: init.headers } : {}
        )
      ).res,
    call,
    send,
    capabilities,
    advertised,
    events,
    pickEvent: async (mode) =>
      (await events()).find(
        (e) => Array.isArray(e.delivery) && e.delivery.includes(mode)
      ),
    callback: () => {
      tagCounter += 1;
      const tag = `${o.dialect}-${tagCounter}-${Math.random().toString(36).slice(2, 8)}`;
      const base = o.receiver.url.replace(/\/+$/, "");
      return { url: `${base}/c/${tag}`, tag };
    },
  };
}

/** The JSON-RPC code a profile uses for an error kind. */
export function codeFor(
  dialect: ConformanceProfile,
  kind: EventsErrorKind
): number {
  const preset = PRESETS[dialect === "openai" ? "openai@1" : "sep-3415@1"];
  const numbering: string | undefined = preset?.axes.errorCodes;
  const table =
    numbering === "sketch"
      ? EVENTS_ERROR_CODES.sketch
      : numbering === "documented"
        ? EVENTS_ERROR_CODES.documented
        : EVENTS_ERROR_CODES.sep;
  return table[kind];
}

/** Minimal arguments that satisfy an `inputSchema`'s required properties. */
export function sampleArgs(schema: unknown): Record<string, unknown> {
  const s = (schema ?? {}) as Record<string, unknown>;
  const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(s.required) ? (s.required as string[]) : [];
  const out: Record<string, unknown> = {};
  for (const key of required) {
    const p = props[key] ?? {};
    out[key] = sampleValue(p);
  }
  return out;
}

function sampleValue(p: Record<string, unknown>): unknown {
  if ("default" in p) return p.default;
  if ("const" in p) return p.const;
  if (Array.isArray(p.enum) && p.enum.length > 0) return p.enum[0];
  const type: unknown = Array.isArray(p.type)
    ? (p.type as unknown[])[0]
    : p.type;
  switch (type) {
    case "integer":
    case "number":
      return typeof p.minimum === "number" ? p.minimum : 1;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return sampleArgs(p);
    case "null":
      return null;
    default:
      return "conformance";
  }
}

/** Subscribe params for a webhook subscription to `e` at `url`. */
export function subscribeParams(
  e: EventDescriptor,
  url: string,
  secret: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name: e.name,
    arguments: sampleArgs(e.inputSchema),
    delivery: { mode: "webhook", url, secret },
    ...extra,
  };
}

/** A fresh `whsec_` secret. */
export function newSecret(): string {
  return generateWebhookSecret();
}

/** Resolves after `ms`. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Waits for a delivery, or resolves `undefined` on timeout. */
export async function maybeNext(
  r: ReceiverHandle,
  pred: (d: ReceivedDelivery) => boolean,
  ms: number
): Promise<ReceivedDelivery | undefined> {
  try {
    return await r.next(pred, ms);
  } catch {
    return undefined;
  }
}

const CONTROL_TYPES: ReadonlySet<string> = new Set([
  "verification",
  "gap",
  "terminated",
]);

/** Whether a delivery body is a control envelope (of `type`, when given). */
export function isControl(d: ReceivedDelivery, type?: string): boolean {
  const j = d.json as Record<string, unknown> | null;
  if (!j || typeof j !== "object" || typeof j.type !== "string") return false;
  return type === undefined ? CONTROL_TYPES.has(j.type) : j.type === type;
}
