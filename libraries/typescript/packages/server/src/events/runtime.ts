/**
 * MCP Events runtime: `events/list`, `events/subscribe`, `events/unsubscribe`,
 * `events/poll`, callback verification, fan-out on emit, signed webhook
 * delivery with retries, and `notifications/events/list_changed` on
 * `subscriptions/listen`. Two dialects share it: ChatGPT's (OpenAI) and the
 * official SEP-3415 extension. Loaded lazily the first time a server uses
 * Events.
 *
 * @internal
 */

import type { AuthInfo } from "@modelcontextprotocol/server";

import type {
  AnyEventDefinition,
  EmitOptions,
  EmitResult,
  EventsOptions,
} from "./define.js";
import {
  fileEventsStore,
  memoryEventsStore,
  upstashEventsStore,
  type EventsStore,
} from "./store.js";
import { EVENTS_EXTENSION_ID } from "./sdk-adapter.js";
import {
  MAX_BODY_BYTES,
  parseWebhookSecret,
  postWebhook,
  signWebhook,
} from "./webhook.js";

const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";
const SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId";
const INVALID_PARAMS = -32602;
const HEADER_MISMATCH = -32020;
/** Error codes that differ between the dialects. */
const CODES = {
  chatgpt: { notFound: INVALID_PARAMS, callback: -32015 },
  sep: { notFound: -32023, callback: -32027 },
} as const;
const FORBIDDEN = -32024;
const POLL_RETENTION_MS = 3_600_000;
const POLL_RETENTION_COUNT = 1000;
const CATALOG_CHECK_MS = 30_000;
const KEEPALIVE_MS = 15_000;
const DAY = 86_400_000;
const MIN_TTL = 60_000;
const MAX_TTL = 30 * DAY;
const ROTATION_WINDOW = DAY;
const VERIFIED_TTL = 3_600_000;
const RETRY_DELAYS = [10_000, 60_000, 300_000, 1_800_000, 7_200_000];
const QUEUE = "queue";
/** How often queued retries are checked while any are pending. */
const RETRY_POLL_MS = 60_000;
/**
 * `chatgpt`: OpenAI's dialect (`-32015`, `webhook-id` = `eventId`, webhook
 * only). `sep`: the official extension (`-32023..-32027`, server-generated
 * `webhook-id`, poll as well).
 */
type Dialect = "chatgpt" | "sep";

/** What the HTTP layer knows about an `events/*` request. */
interface EventsRequestContext {
  request: Request;
  /** A pre-2026-07-28 request. */
  legacy: boolean;
  clientName: string | null;
}

interface Subscription {
  id: string;
  dialect?: Dialect;
  principal: string;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
  /** Sealed secrets, current first; the previous one until `previousUntil`. */
  secrets: string[];
  previousUntil?: number;
  expiresAt: number | null;
}

interface Job {
  subId: string;
  eventId: string;
  /** `webhook-id`, stable across retries. */
  webhookId?: string;
  body: string;
  attempt: number;
}

type RpcOutcome =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } };

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
    readonly status?: number
  ) {
    super(message);
  }
}

interface LogEntry {
  seq: number;
  eventId: string;
  timestamp: string;
  data: unknown;
  at: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Choose the dialect for one request: ChatGPT for OpenAI clients, OpenAI
 * callback hosts and legacy-era requests; the official one when the client
 * declares the extension or sends `Mcp-Name`; ChatGPT otherwise.
 */
function pickDialect(
  p: Record<string, unknown>,
  ctx: EventsRequestContext
): Dialect {
  if (ctx.legacy || /^openai-mcp/i.test(ctx.clientName ?? "")) return "chatgpt";
  const url = record(p.delivery)?.url;
  try {
    const host = new URL(String(url)).hostname;
    if (host === "openai.com" || host.endsWith(".openai.com")) return "chatgpt";
  } catch {
    // no callback URL
  }
  const caps = record(record(p._meta)?.[CLIENT_CAPABILITIES_META_KEY]);
  if (
    record(caps?.extensions)?.[EVENTS_EXTENSION_ID] !== undefined ||
    ctx.request.headers.has("mcp-name")
  )
    return "sep";
  return "chatgpt";
}

/** Decode a SEP-2243 header value (`=?base64?...?=` sentinel or plain). */
function decodeHeader(value: string): string | undefined {
  const m = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!m) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(m[1]!), (c) => c.charCodeAt(0))
    );
  } catch {
    return undefined;
  }
}

function headerString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number")
    return String(value);
  return undefined;
}

/** Category for a failed callback POST (`deliveryStatus.lastError`). */
function failureReason(status: number, error: string | null): string {
  if (status !== 0) return "challenge_failed";
  if (/timeout|timedout|abort/i.test(error ?? "")) return "timeout";
  if (/cert|tls|ssl/i.test(error ?? "")) return "tls_error";
  return "connection_refused";
}

function encodeCursor(epoch: string, seq: number): string {
  return btoa(`${epoch}:${seq}`).replace(/=+$/, "");
}

function decodeCursor(cursor: string): { epoch: string; seq: number } | null {
  try {
    const [epoch, seq] = atob(cursor).split(":");
    const n = Number(seq);
    return epoch && Number.isSafeInteger(n) && n >= 0
      ? { epoch, seq: n }
      : null;
  } catch {
    return null;
  }
}

/** Process-wide catalog-change listeners (old and new server instances in dev). */
const CATALOG_LISTENERS = Symbol.for("mcp-use.events.catalog");
function catalogListeners(): Set<(hash: string) => void> {
  const g = globalThis as { [CATALOG_LISTENERS]?: Set<(hash: string) => void> };
  return (g[CATALOG_LISTENERS] ??= new Set());
}

/** The SDK server event bus, as far as `subscriptions/listen` needs it. */
interface ListenBus {
  subscribe(
    listener: (event: { kind: string; uri?: string }) => void
  ): () => void;
}

const CORE_NOTIFICATIONS: Record<string, [string, string]> = {
  tools_list_changed: ["toolsListChanged", "notifications/tools/list_changed"],
  prompts_list_changed: [
    "promptsListChanged",
    "notifications/prompts/list_changed",
  ],
  resources_list_changed: [
    "resourcesListChanged",
    "notifications/resources/list_changed",
  ],
};

type Env = Record<string, string | undefined>;

function env(): Env {
  return (globalThis as { process?: { env?: Env } }).process?.env ?? {};
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function unb64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i % Math.max(b.length, 1));
  return diff === 0;
}

async function toJsonSchema(
  schema: AnyEventDefinition["inputSchema"],
  direction: "input" | "output"
): Promise<Record<string, unknown>> {
  if (schema === undefined)
    return { type: "object", properties: {}, additionalProperties: false };
  const exported = schema["~standard"].jsonSchema[direction]({
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = exported;
  if (rest.type === "object" && !("additionalProperties" in rest))
    rest.additionalProperties = false;
  return rest;
}

async function validate(
  schema: AnyEventDefinition["inputSchema"],
  value: unknown
): Promise<{ ok: true; value: unknown } | { ok: false; issues: unknown }> {
  if (schema === undefined) return { ok: true, value };
  const r = await schema["~standard"].validate(value);
  return r.issues
    ? { ok: false, issues: r.issues }
    : { ok: true, value: r.value };
}

/** Default filter: same-named argument and top-level data fields must be equal. */
function declarativeMatch(args: Record<string, unknown>, data: unknown) {
  if (data === null || typeof data !== "object") return true;
  const d = data as Record<string, unknown>;
  return Object.entries(args).every(
    ([k, v]) => !(k in d) || canonical(d[k]) === canonical(v)
  );
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "invalid";
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
}

/** The Events runtime of one server. */
export class EventsRuntime {
  readonly #defs: ReadonlyMap<string, AnyEventDefinition>;
  readonly #options: EventsOptions;
  readonly #store: EventsStore;
  readonly #sealKeys: Promise<CryptoKey[]>;
  readonly #insecure: boolean;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #retryAt = 0;
  #processing: Promise<void> | undefined;
  #epoch: Promise<string> | undefined;
  readonly #catalog: Promise<string>;
  readonly #headerParams = new Map<string, Promise<Record<string, string>>>();
  #warnedMissingName = false;

  /**
   * @param defs - Registered event definitions.
   * @param options - `ServerConfig.events`.
   */
  constructor(
    defs: ReadonlyMap<string, AnyEventDefinition>,
    options: EventsOptions = {}
  ) {
    const e = env();
    this.#defs = defs;
    this.#options = options;
    this.#insecure =
      options.allowInsecureCallbacks ?? e.MCP_USE_EVENTS_INSECURE === "1";
    const url = e.MCP_USE_PLATFORM_STORAGE_URL;
    const token = e.MCP_USE_PLATFORM_STORAGE_TOKEN;
    const ns = e.MCP_USE_PLATFORM_NAMESPACE;
    const dir = e.MCP_USE_EVENTS_STATE_DIR;
    this.#store =
      options.store ??
      (url && token
        ? upstashEventsStore({
            url,
            token,
            prefix: `${e.MCP_USE_PLATFORM_STORAGE_PREFIX ?? ""}${ns ? `${ns}:` : ""}events:`,
          })
        : dir
          ? fileEventsStore(dir)
          : memoryEventsStore());
    console.info(
      `[mcp-use] Events store: ${
        options.store
          ? "custom"
          : url && token
            ? `Upstash REST (platform storage, host ${safeHost(url)})`
            : dir
              ? `file (${dir})`
              : "in-memory (not shared across instances)"
      }`
    );
    this.#sealKeys = Promise.all(
      list(e.MCP_USE_PLATFORM_SECRET).map(async (s) =>
        crypto.subtle.importKey(
          "raw",
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
          "AES-GCM",
          false,
          ["encrypt", "decrypt"]
        )
      )
    );
    this.#catalog = this.#syncCatalog();
    // Resume retries persisted by a previous process (file or Upstash store).
    void this.process().catch(() => undefined);
  }

  /**
   * Hash the event catalog; when it differs from the stored hash (a hot
   * reload, deploy or rollback), store it and wake every listen stream.
   */
  async #syncCatalog(): Promise<string> {
    const hash = await sha256(canonical(await this.#list("sep")));
    try {
      if ((await this.#store.get("catalog")) !== hash) {
        await this.#store.set("catalog", hash);
        for (const listener of catalogListeners()) listener(hash);
      }
    } catch (err) {
      console.warn(
        `[mcp-use] events catalog sync failed: ${(err as Error)?.message ?? err}`
      );
    }
    return hash;
  }

  /**
   * Answer one `events/*` JSON-RPC request. `status` is set for errors that
   * need a non-200 HTTP status (header mismatch: 400).
   */
  async handle(
    method: string,
    params: unknown,
    authInfo: AuthInfo | undefined,
    ctx: EventsRequestContext
  ): Promise<{ outcome: RpcOutcome; status?: number }> {
    const p = record(params) ?? {};
    const dialect = pickDialect(p, ctx);
    try {
      if (method !== "events/list") await this.#checkHeaders(p, ctx, dialect);
      switch (method) {
        case "events/list":
          return { outcome: { result: await this.#list(dialect) } };
        case "events/subscribe":
          return {
            outcome: {
              result: await this.#subscribe(p, principalOf(authInfo), dialect),
            },
          };
        case "events/unsubscribe":
          return {
            outcome: {
              result: await this.#unsubscribe(
                p,
                principalOf(authInfo),
                dialect
              ),
            },
          };
        case "events/poll":
          return { outcome: { result: await this.#poll(p, dialect) } };
        default:
          return {
            outcome: {
              error: { code: -32601, message: `Method not found: ${method}` },
            },
          };
      }
    } catch (error) {
      if (error instanceof RpcError)
        return {
          outcome: {
            error: {
              code: error.code,
              message: error.message,
              ...(error.data !== undefined && { data: error.data }),
            },
          },
          ...(error.status !== undefined && { status: error.status }),
        };
      return {
        outcome: { error: { code: -32603, message: (error as Error).message } },
      };
    }
  }

  async #list(dialect: Dialect) {
    const events = await Promise.all(
      [...this.#defs.values()].map(async (d) => ({
        name: d.name,
        ...(d.description !== undefined && { description: d.description }),
        delivery: dialect === "sep" ? ["webhook", "poll"] : ["webhook"],
        inputSchema: await toJsonSchema(d.inputSchema, "input"),
        payloadSchema: await toJsonSchema(d.payloadSchema, "output"),
      }))
    );
    return { events };
  }

  #def(p: Record<string, unknown>, dialect: Dialect) {
    const name = p.name;
    const def = typeof name === "string" ? this.#defs.get(name) : undefined;
    if (def === undefined)
      throw new RpcError(
        CODES[dialect].notFound,
        `Unknown event: ${String(name)}`,
        dialect === "sep" ? { kind: "event" } : undefined
      );
    return def;
  }

  /** `x-mcp-header` annotations of an event's arguments, by property name. */
  #annotations(def: AnyEventDefinition): Promise<Record<string, string>> {
    let found = this.#headerParams.get(def.name);
    if (found === undefined) {
      found = toJsonSchema(def.inputSchema, "input").then((schema) => {
        const out: Record<string, string> = {};
        for (const [prop, s] of Object.entries(record(schema.properties) ?? {}))
          if (typeof record(s)?.["x-mcp-header"] === "string")
            out[prop] = record(s)!["x-mcp-header"] as string;
        return out;
      });
      this.#headerParams.set(def.name, found);
    }
    return found;
  }

  /**
   * Validate `Mcp-Name` and `Mcp-Param-*` against the body (SEP-2243). A
   * mismatch is a 400 `HeaderMismatch`; a missing header is accepted.
   */
  async #checkHeaders(
    p: Record<string, unknown>,
    ctx: EventsRequestContext,
    dialect: Dialect
  ) {
    const headers = ctx.request.headers;
    const mismatch = (header: string, body: unknown) =>
      new RpcError(
        HEADER_MISMATCH,
        `Bad Request: the ${header} header does not match the request body`,
        { mismatch: { header, body } },
        400
      );
    const name = headers.get("mcp-name");
    if (name === null) {
      if (dialect === "sep" && !this.#warnedMissingName) {
        this.#warnedMissingName = true;
        console.warn(
          "[mcp-use] events/* request without an Mcp-Name header (accepted)"
        );
      }
    } else if (decodeHeader(name) !== p.name)
      throw mismatch("Mcp-Name", p.name);
    const def = typeof p.name === "string" ? this.#defs.get(p.name) : undefined;
    if (def === undefined) return;
    const args = record(p.arguments) ?? {};
    for (const [prop, header] of Object.entries(await this.#annotations(def))) {
      const expected = headerString(args[prop]);
      const sent = headers.get(`mcp-param-${header}`);
      if (expected === undefined || sent === null) continue;
      if (decodeHeader(sent) !== expected)
        throw mismatch(`Mcp-Param-${header}`, args[prop]);
    }
  }

  async #identify(
    p: Record<string, unknown>,
    principal: string,
    dialect: Dialect
  ) {
    const def = this.#def(p, dialect);
    const delivery = (p.delivery ?? {}) as Record<string, unknown>;
    if (delivery.mode !== "webhook" || typeof delivery.url !== "string")
      throw new RpcError(
        INVALID_PARAMS,
        'delivery must be { mode: "webhook", url, secret }'
      );
    let url: URL;
    try {
      url = new URL(delivery.url);
    } catch {
      throw new RpcError(INVALID_PARAMS, "delivery.url is not a URL");
    }
    if (
      url.protocol !== "https:" &&
      !(this.#insecure && url.protocol === "http:")
    )
      throw new RpcError(INVALID_PARAMS, "delivery.url must use https");
    const args = await validate(def.inputSchema, p.arguments ?? {});
    if (!args.ok)
      throw new RpcError(INVALID_PARAMS, "Invalid arguments", {
        issues: args.issues,
      });
    const argumentsValue = (args.value ?? {}) as Record<string, unknown>;
    const id = `sub_${(
      await sha256(
        canonical([principal, delivery.url, def.name, argumentsValue])
      )
    ).slice(0, 32)}`;
    return { def, delivery, url: delivery.url, args: argumentsValue, id };
  }

  async #subscribe(
    p: Record<string, unknown>,
    principal: string,
    dialect: Dialect
  ) {
    if (dialect === "sep" && principal === "anonymous" && !this.#insecure)
      throw new RpcError(
        FORBIDDEN,
        "Webhook delivery requires an authenticated principal",
        { reason: "unauthenticated" }
      );
    const { def, delivery, url, args, id } = await this.#identify(
      p,
      principal,
      dialect
    );
    const secret = delivery.secret;
    if (parseWebhookSecret(secret) === undefined)
      throw new RpcError(
        INVALID_PARAMS,
        "delivery.secret must be whsec_ + base64 of 24-64 bytes"
      );
    const ttl = p.ttlMs;
    if (
      ttl !== undefined &&
      ttl !== null &&
      (typeof ttl !== "number" || ttl <= 0)
    )
      throw new RpcError(
        INVALID_PARAMS,
        "ttlMs must be a positive number or null"
      );
    await this.#verifyCallback(
      principal,
      url,
      secret as string,
      id,
      def.name,
      dialect
    );

    const now = Date.now();
    const existing = await this.#getSub(id);
    const sealed = await this.#seal(secret as string);
    const secrets = [sealed];
    let previousUntil: number | undefined;
    if (existing) {
      const current = await this.#unseal(existing.secrets[0]!);
      if (current !== secret) {
        secrets.push(existing.secrets[0]!);
        previousUntil = now + ROTATION_WINDOW;
      } else if (existing.previousUntil && existing.previousUntil > now) {
        secrets.push(...existing.secrets.slice(1));
        previousUntil = existing.previousUntil;
      }
    }
    const expiresAt =
      ttl === null
        ? null
        : now +
          (typeof ttl === "number"
            ? Math.min(Math.max(ttl, MIN_TTL), MAX_TTL)
            : (this.#options.defaultTtlMs ?? DAY));
    const sub: Subscription = {
      id,
      dialect,
      principal,
      name: def.name,
      arguments: args,
      url,
      secrets,
      ...(previousUntil !== undefined && { previousUntil }),
      expiresAt,
    };
    // Write the record, then the index. If indexing fails, roll the record
    // back to its previous state so a failed subscribe leaves nothing behind.
    const key = `sub:${id}`;
    await this.#store.set(
      key,
      JSON.stringify(sub),
      expiresAt === null ? undefined : expiresAt - now
    );
    try {
      await this.#store.sadd(`subs:${def.name}`, id);
    } catch (err) {
      await (
        existing
          ? this.#store.set(
              key,
              JSON.stringify(existing),
              existing.expiresAt === null
                ? undefined
                : Math.max(existing.expiresAt - now, 1)
            )
          : this.#store.del(key)
      ).catch(() => undefined);
      throw err;
    }
    return {
      id,
      refreshBefore:
        expiresAt === null ? null : new Date(expiresAt).toISOString(),
      cursor: null,
      truncated: false,
    };
  }

  async #unsubscribe(
    p: Record<string, unknown>,
    principal: string,
    dialect: Dialect
  ) {
    const { def, id } = await this.#identify(p, principal, dialect);
    if (dialect === "sep" && (await this.#getSub(id)) === undefined)
      throw new RpcError(CODES.sep.notFound, "Subscription not found", {
        kind: "subscription",
      });
    await this.#store.del(`sub:${id}`);
    await this.#store.srem(`subs:${def.name}`, id);
    return {};
  }

  /** Send the verification challenge unless this principal+URL verified recently. */
  async #verifyCallback(
    principal: string,
    url: string,
    secret: string,
    subId: string,
    name: string,
    dialect: Dialect
  ) {
    const key = `verified:${await sha256(`${principal}\n${url}`)}`;
    if ((await this.#store.get(key)) !== null) return;
    const challenge = randomId();
    const body = JSON.stringify({ type: "verification", challenge });
    const res = await this.#post(
      url,
      [secret],
      `msg_verification_${randomId()}`,
      body,
      subId
    );
    let echoed: unknown;
    try {
      echoed = (JSON.parse(res.body) as { challenge?: unknown }).challenge;
    } catch {
      echoed = undefined;
    }
    const passed =
      res.status >= 200 &&
      res.status < 300 &&
      typeof echoed === "string" &&
      constantTimeEqual(echoed, challenge);
    const code = CODES[dialect].callback;
    if (res.status === 0)
      throw new RpcError(code, "Callback endpoint unreachable", {
        reason: dialect === "sep" ? failureReason(0, res.error) : "timeout",
      });
    if (!passed)
      throw new RpcError(code, "Callback verification failed", {
        reason: "challenge_failed",
        ...(dialect === "chatgpt" && { status: res.status }),
      });
    await this.#store.set(key, "1", VERIFIED_TTL);
  }

  async #post(
    url: string,
    secrets: string[],
    webhookId: string,
    body: string,
    subId: string
  ) {
    const timestamp = Math.floor(Date.now() / 1000);
    return await postWebhook(
      url,
      {
        "webhook-id": webhookId,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": await signWebhook(
          secrets,
          webhookId,
          timestamp,
          body
        ),
        "x-mcp-subscription-id": subId,
      },
      body,
      { allowInsecure: this.#insecure, fetch: this.#options.fetch }
    ).then(
      (r) => ({
        ...r,
        error:
          r.status === 0
            ? (r.error ?? "network error")
            : (null as string | null),
      }),
      (err: unknown) => ({
        status: 0,
        body: "",
        error: String((err as Error)?.message ?? err).slice(0, 120) as
          | string
          | null,
      })
    );
  }

  /** Log a failed attempt so delivery failures are visible. */
  #logFailure(a: {
    name: string;
    subscriptionId: string;
    url: string;
    attempt: number;
    status: number;
    error: string | null;
  }) {
    console.warn(
      `[mcp-use] events delivery failed: ${a.name} ${a.subscriptionId} -> ${originOf(a.url)} ${a.status === 0 ? a.error : a.status} attempt ${a.attempt}`
    );
  }

  /** Fan an event out to matching subscriptions and attempt delivery once. */
  async emit(
    name: string,
    data: unknown,
    options: EmitOptions = {}
  ): Promise<EmitResult> {
    const def = this.#defs.get(name);
    if (def === undefined) throw new Error(`Unknown event: ${name}`);
    const checked = await validate(def.payloadSchema, data);
    if (!checked.ok)
      throw new TypeError(
        `${name}: data does not match payloadSchema: ${JSON.stringify(checked.issues)}`
      );
    const eventId = options.eventId ?? `evt_${randomId()}`;
    const body = JSON.stringify({
      eventId,
      name,
      timestamp: (options.timestamp ?? new Date()).toISOString(),
      data: checked.value,
      cursor: null,
    });
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
      throw new RangeError(`${name}: event body exceeds 256 KiB`);
    await this.#append(name, {
      eventId,
      timestamp: (JSON.parse(body) as { timestamp: string }).timestamp,
      data: checked.value,
    });

    let deliveries = 0;
    const now = Date.now();
    for (const id of await this.#store.smembers(`subs:${name}`)) {
      const sub = await this.#getSub(id);
      if (
        sub === undefined ||
        (sub.expiresAt !== null && sub.expiresAt <= now)
      ) {
        await this.#store.srem(`subs:${name}`, id);
        continue;
      }
      const match = def.matches ?? declarativeMatch;
      if (!match(sub.arguments as never, checked.value as never)) continue;
      const job: Job = {
        subId: id,
        eventId,
        webhookId: sub.dialect === "sep" ? `msg_${randomId()}` : eventId,
        body,
        attempt: 0,
      };
      const jobId = `${eventId}:${id}`;
      await this.#store.set(`job:${jobId}`, JSON.stringify(job), 2 * DAY);
      await this.#store.zadd(QUEUE, now, jobId);
      deliveries++;
    }
    if (deliveries > 0) await this.process();
    return { eventId, deliveries };
  }

  /** Attempt every due delivery. */
  process(): Promise<void> {
    this.#processing ??= this.#drain().finally(() => {
      this.#processing = undefined;
    });
    return this.#processing;
  }

  async #drain() {
    const due = await this.#store.zdue(QUEUE, Date.now(), 100);
    await Promise.all(due.map((jobId) => this.#attempt(jobId)));
    // Jobs still queued (later retries, a full batch, or jobs persisted
    // before a restart) need the timer re-armed.
    if ((await this.#store.zrange(QUEUE, 0, 0)).length > 0)
      this.#scheduleRetry(due.length >= 100 ? 1000 : RETRY_POLL_MS);
  }

  async #attempt(jobId: string) {
    if (!(await this.#store.zrem(QUEUE, jobId))) return;
    const raw = await this.#store.get(`job:${jobId}`);
    const job = raw ? (JSON.parse(raw) as Job) : undefined;
    const sub = job ? await this.#getSub(job.subId) : undefined;
    if (job === undefined || sub === undefined) {
      await this.#store.del(`job:${jobId}`);
      return;
    }
    const now = Date.now();
    const sealed =
      sub.previousUntil && sub.previousUntil > now
        ? sub.secrets
        : sub.secrets.slice(0, 1);
    const secrets = await Promise.all(sealed.map((s) => this.#unseal(s)));
    const res = await this.#post(
      sub.url,
      secrets,
      job.webhookId ?? job.eventId,
      job.body,
      sub.id
    );
    const ok = res.status >= 200 && res.status < 300;
    if (!ok)
      this.#logFailure({
        name: sub.name,
        subscriptionId: sub.id,
        url: sub.url,
        attempt: job.attempt + 1,
        status: res.status,
        error: res.error,
      });
    if (res.status === 410) {
      await this.#store.del(`sub:${sub.id}`);
      await this.#store.srem(`subs:${sub.name}`, sub.id);
    }
    const delay = RETRY_DELAYS[job.attempt];
    if (ok || res.status === 410 || res.status === 413 || delay === undefined) {
      await this.#store.del(`job:${jobId}`);
      return;
    }
    job.attempt++;
    await this.#store.set(`job:${jobId}`, JSON.stringify(job), 2 * DAY);
    await this.#store.zadd(QUEUE, now + delay, jobId);
    this.#scheduleRetry(delay);
  }

  /**
   * Arm the in-process timer that runs due retries, keeping the earliest
   * deadline. Long-running servers rely on it; nothing else wakes retries.
   */
  #scheduleRetry(delay: number) {
    const at = Date.now() + delay;
    if (this.#retryTimer !== undefined && this.#retryAt <= at) return;
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
    this.#retryAt = at;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.process().catch(() => undefined);
    }, delay);
    (this.#retryTimer as { unref?: () => void }).unref?.();
  }

  /** Stop the in-process retry timer. */
  close() {
    if (this.#retryTimer !== undefined) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
  }

  #storeEpoch(): Promise<string> {
    this.#epoch ??= (async () => {
      const found = await this.#store.get("log:epoch");
      if (found !== null) return found;
      const epoch = randomId().slice(0, 12);
      await this.#store.set("log:epoch", epoch);
      return epoch;
    })();
    return this.#epoch;
  }

  /** Append an occurrence to the poll log and trim it (1 hour, 1000 entries). */
  async #append(name: string, e: Omit<LogEntry, "seq" | "at">) {
    try {
      const s = this.#store;
      const key = `log:${name}`;
      const seq = await s.incr(`seq:${name}`);
      const now = Date.now();
      await s.zadd(key, seq, JSON.stringify({ seq, ...e, at: now }));
      const stale = new Set(
        await s.zrange(key, 0, -(POLL_RETENTION_COUNT + 1))
      );
      for (const m of await s.zrange(key, 0, 49))
        if ((JSON.parse(m) as LogEntry).at < now - POLL_RETENTION_MS)
          stale.add(m);
      let floor = 0;
      for (const m of stale) {
        await s.zrem(key, m);
        floor = Math.max(floor, (JSON.parse(m) as LogEntry).seq);
      }
      if (floor > 0) await s.set(`floor:${name}`, String(floor));
    } catch (err) {
      console.warn(
        `[mcp-use] events poll log write failed: ${(err as Error)?.message ?? err}`
      );
    }
  }

  /** `events/poll`: stateless; the opaque cursor is a position in the log. */
  async #poll(p: Record<string, unknown>, dialect: Dialect) {
    const def = this.#def(p, dialect);
    const args = await validate(def.inputSchema, p.arguments ?? {});
    if (!args.ok)
      throw new RpcError(INVALID_PARAMS, "Invalid arguments", {
        issues: args.issues,
      });
    const max =
      typeof p.maxEvents === "number" && p.maxEvents >= 1
        ? Math.min(Math.floor(p.maxEvents), 1000)
        : 100;
    const s = this.#store;
    const epoch = await this.#storeEpoch();
    const head = Number((await s.get(`seq:${def.name}`)) ?? 0);
    const nextPollMs = this.#options.pollIntervalMs ?? 5000;
    const fresh = (truncated: boolean) => ({
      events: [],
      cursor: encodeCursor(epoch, head),
      truncated,
      hasMore: false,
      nextPollMs,
    });
    if (p.cursor === undefined || p.cursor === null) return fresh(false);
    const at = typeof p.cursor === "string" ? decodeCursor(p.cursor) : null;
    if (at === null || at.epoch !== epoch || at.seq > head) return fresh(true);
    const floor = Number((await s.get(`floor:${def.name}`)) ?? 0);
    let truncated = at.seq < floor;
    const minAt =
      typeof p.maxAgeMs === "number" ? Date.now() - p.maxAgeMs : -Infinity;
    const match = def.matches ?? declarativeMatch;
    const events: unknown[] = [];
    let last = Math.max(at.seq, floor);
    let hasMore = false;
    scan: for (;;) {
      const batch = await s.zafter(`log:${def.name}`, last, 200);
      for (const m of batch) {
        const e = JSON.parse(m) as LogEntry;
        last = e.seq;
        if (e.at < minAt) {
          truncated = true;
          continue;
        }
        if (!match(args.value as never, e.data as never)) continue;
        events.push({
          eventId: e.eventId,
          name: def.name,
          timestamp: e.timestamp,
          data: e.data,
        });
        if (events.length === max) {
          hasMore = (await s.zafter(`log:${def.name}`, last, 1)).length > 0;
          break scan;
        }
      }
      if (batch.length < 200) break;
    }
    return {
      events,
      cursor: encodeCursor(epoch, hasMore ? last : Math.max(head, last)),
      truncated,
      hasMore,
      nextPollMs,
    };
  }

  /**
   * Serve a `subscriptions/listen` request that opts in to
   * `eventsListChanged`: acknowledge the honored filter, then forward core
   * list changes from `bus` and `notifications/events/list_changed` when the
   * catalog hash changes (this process, or the shared store).
   */
  listen(
    message: { id: string | number; params?: unknown },
    signal: AbortSignal | undefined,
    bus: ListenBus | undefined
  ): Response {
    const requested = record(record(message.params)?.notifications) ?? {};
    const honored: Record<string, unknown> = {};
    for (const [flag] of Object.values(CORE_NOTIFICATIONS))
      if (requested[flag] === true) honored[flag] = true;
    if (
      Array.isArray(requested.resourceSubscriptions) &&
      requested.resourceSubscriptions.length > 0
    )
      honored.resourceSubscriptions = (
        requested.resourceSubscriptions as unknown[]
      ).filter((uri) => typeof uri === "string");
    honored.eventsListChanged = true;
    const id = message.id;
    const encoder = new TextEncoder();
    const cleanup: (() => void)[] = [];
    let closed = false;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const frame = (text: string) => {
      if (closed) return;
      try {
        controller.enqueue(encoder.encode(text));
      } catch {
        // stream already gone
      }
    };
    const notify = (method: string, params: Record<string, unknown> = {}) =>
      frame(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          method,
          params: {
            ...params,
            _meta: { [SUBSCRIPTION_ID_META_KEY]: id },
          },
        })}\n\n`
      );
    const teardown = () => {
      if (closed) return;
      closed = true;
      for (const fn of cleanup) fn();
      try {
        controller.close();
      } catch {
        // already closed
      }
    };
    const readable = new ReadableStream<Uint8Array>({
      start: async (c) => {
        controller = c;
        notify("notifications/subscriptions/acknowledged", {
          notifications: honored,
        });
        if (bus !== undefined)
          cleanup.push(
            bus.subscribe((event) => {
              const core = CORE_NOTIFICATIONS[event.kind];
              if (core && honored[core[0]] === true) notify(core[1]);
              if (
                event.kind === "resource_updated" &&
                (
                  honored.resourceSubscriptions as string[] | undefined
                )?.includes(event.uri ?? "")
              )
                notify("notifications/resources/updated", { uri: event.uri });
            })
          );
        let seen = await this.#catalog;
        const changed = (hash: string | null) => {
          if (hash === null || hash === seen) return;
          seen = hash;
          notify("notifications/events/list_changed");
        };
        const listeners = catalogListeners();
        listeners.add(changed);
        cleanup.push(() => listeners.delete(changed));
        const keepAlive = setInterval(
          () => frame(": keepalive\n\n"),
          KEEPALIVE_MS
        );
        const check = setInterval(() => {
          void this.#store.get("catalog").then(changed, () => undefined);
        }, CATALOG_CHECK_MS);
        for (const t of [keepAlive, check]) {
          (t as { unref?: () => void }).unref?.();
          cleanup.push(() => clearInterval(t));
        }
      },
      cancel: teardown,
    });
    if (signal?.aborted) teardown();
    else signal?.addEventListener("abort", teardown, { once: true });
    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  async #getSub(id: string): Promise<Subscription | undefined> {
    const raw = await this.#store.get(`sub:${id}`);
    return raw ? (JSON.parse(raw) as Subscription) : undefined;
  }

  async #seal(secret: string): Promise<string> {
    const [key] = await this.#sealKeys;
    if (key === undefined) return secret;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(secret)
    );
    return `enc:${b64(iv)}:${b64(new Uint8Array(ct))}`;
  }

  async #unseal(value: string): Promise<string> {
    if (!value.startsWith("enc:")) return value;
    const [, iv, ct] = value.split(":");
    for (const key of await this.#sealKeys) {
      try {
        const pt = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: new Uint8Array(unb64(iv!)) },
          key,
          new Uint8Array(unb64(ct!))
        );
        return new TextDecoder().decode(pt);
      } catch {
        // try the next key
      }
    }
    throw new Error(
      "events: cannot unseal a webhook secret (MCP_USE_PLATFORM_SECRET changed?)"
    );
  }
}

/**
 * The subject a subscription belongs to. mcp-use OAuth providers put the
 * verified claims on `extra.payload`; the canonical form is `iss|sub`. A
 * bare `extra.sub` (custom verifiers) is also accepted. Falling back to the
 * OAuth client would let every user of one client share subscriptions.
 */
function principalOf(authInfo: AuthInfo | undefined): string {
  const extra = record(authInfo?.extra);
  const payload = record(extra?.payload);
  const sub = payload?.sub ?? extra?.sub;
  if (typeof sub === "string" && sub !== "") {
    const iss = payload?.iss;
    return typeof iss === "string" && iss !== ""
      ? `${iss}|${sub}`
      : `user:${sub}`;
  }
  return authInfo?.clientId ? `client:${authInfo.clientId}` : "anonymous";
}
