/**
 * MCP Events runtime: `events/list`, `events/subscribe`, `events/unsubscribe`,
 * callback verification, fan-out on emit, and signed webhook delivery with
 * retries. Loaded lazily the first time a server uses Events.
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
  memoryEventsStore,
  upstashEventsStore,
  type EventsStore,
} from "./store.js";
import {
  MAX_BODY_BYTES,
  parseWebhookSecret,
  postWebhook,
  signWebhook,
} from "./webhook.js";

/** JSON-RPC error code for a callback that failed verification. */
const CALLBACK_ENDPOINT_ERROR = -32015;
const INVALID_PARAMS = -32602;
const DAY = 86_400_000;
const MIN_TTL = 60_000;
const MAX_TTL = 30 * DAY;
const ROTATION_WINDOW = DAY;
const VERIFIED_TTL = 3_600_000;
const RETRY_DELAYS = [10_000, 60_000, 300_000, 1_800_000, 7_200_000];
const QUEUE = "queue";
const LOG = "deliveries";
const LOG_TTL = 7 * DAY;
const LOG_CAP = 1000;

/** One webhook attempt, as kept in the delivery log. */
interface DeliveryRecord {
  id: string;
  kind: "verification" | "event";
  eventId: string | null;
  name: string;
  subscriptionId: string;
  callbackOrigin: string;
  attempt: number;
  status: number | null;
  ok: boolean;
  error: string | null;
  durationMs: number;
  at: string;
}

interface Subscription {
  id: string;
  principal: string;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
  /** Sealed secrets, current first; the previous one until `previousUntil`. */
  secrets: string[];
  previousUntil?: number;
  expiresAt: number | null;
  clientName?: string | null;
  createdAt?: number;
}

interface Job {
  subId: string;
  eventId: string;
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
    readonly data?: unknown
  ) {
    super(message);
  }
}

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
  #processing: Promise<void> | undefined;

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
    this.#store =
      options.store ??
      (url && token
        ? upstashEventsStore({
            url,
            token,
            prefix: `${e.MCP_USE_PLATFORM_STORAGE_PREFIX ?? ""}${ns ? `${ns}:` : ""}events:`,
          })
        : memoryEventsStore());
    console.info(
      `[mcp-use] Events store: ${
        options.store
          ? "custom"
          : url && token
            ? `Upstash REST (platform storage, host ${safeHost(url)})`
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
  }

  /** Answer one `events/*` JSON-RPC request. */
  async handle(
    method: string,
    params: unknown,
    authInfo: AuthInfo | undefined,
    clientName: string | null = null
  ): Promise<RpcOutcome> {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      switch (method) {
        case "events/list":
          return { result: await this.#list() };
        case "events/subscribe":
          return {
            result: await this.#subscribe(p, principalOf(authInfo), clientName),
          };
        case "events/unsubscribe":
          return { result: await this.#unsubscribe(p, principalOf(authInfo)) };
        default:
          return {
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }
    } catch (error) {
      if (error instanceof RpcError)
        return {
          error: {
            code: error.code,
            message: error.message,
            ...(error.data !== undefined && { data: error.data }),
          },
        };
      return { error: { code: -32603, message: (error as Error).message } };
    }
  }

  async #list() {
    const events = await Promise.all(
      [...this.#defs.values()].map(async (d) => ({
        name: d.name,
        ...(d.description !== undefined && { description: d.description }),
        delivery: ["webhook"],
        inputSchema: await toJsonSchema(d.inputSchema, "input"),
        payloadSchema: await toJsonSchema(d.payloadSchema, "output"),
      }))
    );
    return { events };
  }

  async #identify(p: Record<string, unknown>, principal: string) {
    const name = p.name;
    const def = typeof name === "string" ? this.#defs.get(name) : undefined;
    if (def === undefined)
      throw new RpcError(INVALID_PARAMS, `Unknown event: ${String(name)}`);
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
    clientName: string | null
  ) {
    const { def, delivery, url, args, id } = await this.#identify(p, principal);
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
    await this.#verifyCallback(principal, url, secret as string, id, def.name);

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
      principal,
      name: def.name,
      arguments: args,
      url,
      secrets,
      ...(previousUntil !== undefined && { previousUntil }),
      expiresAt,
      clientName: clientName ?? existing?.clientName ?? null,
      createdAt: existing?.createdAt ?? now,
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

  async #unsubscribe(p: Record<string, unknown>, principal: string) {
    const { def, id } = await this.#identify(p, principal);
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
    name: string
  ) {
    const key = `verified:${await sha256(`${principal}\n${url}`)}`;
    if ((await this.#store.get(key)) !== null) return;
    const challenge = randomId();
    const body = JSON.stringify({ type: "verification", challenge });
    const started = Date.now();
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
    await this.#record({
      kind: "verification",
      eventId: null,
      name,
      subscriptionId: subId,
      url,
      attempt: 1,
      status: res.status,
      ok: passed,
      error:
        res.status === 0
          ? res.error
          : passed
            ? null
            : res.status >= 200 && res.status < 300
              ? "challenge mismatch"
              : `HTTP ${res.status}`,
      started,
    });
    if (res.status === 0)
      throw new RpcError(
        CALLBACK_ENDPOINT_ERROR,
        "Callback endpoint unreachable",
        {
          reason: "timeout",
        }
      );
    if (!passed)
      throw new RpcError(
        CALLBACK_ENDPOINT_ERROR,
        "Callback verification failed",
        {
          reason: "challenge_failed",
          status: res.status,
        }
      );
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
        error: r.status === 0 ? "network error" : (null as string | null),
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

  /** Log one attempt and append it to the delivery log. Never throws. */
  async #record(a: {
    kind: DeliveryRecord["kind"];
    eventId: string | null;
    name: string;
    subscriptionId: string;
    url: string;
    attempt: number;
    status: number;
    ok: boolean;
    error: string | null;
    started: number;
  }) {
    const now = Date.now();
    const rec: DeliveryRecord = {
      id: `dlv_${randomId()}`,
      kind: a.kind,
      eventId: a.eventId,
      name: a.name,
      subscriptionId: a.subscriptionId,
      callbackOrigin: originOf(a.url),
      attempt: a.attempt,
      status: a.status === 0 ? null : a.status,
      ok: a.ok,
      error: a.error,
      durationMs: now - a.started,
      at: new Date(now).toISOString(),
    };
    console.info(
      `[mcp-use] events delivery ${rec.name} ${rec.subscriptionId} -> ${rec.callbackOrigin} ${rec.status ?? rec.error} ${rec.durationMs}ms attempt ${rec.attempt}`
    );
    try {
      const s = this.#store;
      await s.set(`dlv:${rec.id}`, JSON.stringify(rec), LOG_TTL);
      await s.zadd(LOG, now, rec.id);
      const stale = [
        ...(await s.zdue(LOG, now - LOG_TTL, 200)),
        ...(await s.zrange(LOG, 0, -(LOG_CAP + 1))),
      ];
      for (const id of new Set(stale)) {
        await s.zrem(LOG, id);
        await s.del(`dlv:${id}`);
      }
    } catch (err) {
      console.warn(
        `[mcp-use] events delivery log write failed: ${(err as Error)?.message ?? err}`
      );
    }
  }

  /** Delivery records, newest first. */
  async #deliveries(): Promise<DeliveryRecord[]> {
    const ids = (await this.#store.zrange(LOG, -LOG_CAP, -1)).reverse();
    const out: DeliveryRecord[] = [];
    for (const id of ids) {
      const raw = await this.#store.get(`dlv:${id}`);
      if (raw) out.push(JSON.parse(raw) as DeliveryRecord);
    }
    return out;
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
      const job: Job = { subId: id, eventId, body, attempt: 0 };
      const jobId = `${eventId}:${id}`;
      await this.#store.set(`job:${jobId}`, JSON.stringify(job), 2 * DAY);
      await this.#store.zadd(QUEUE, now, jobId);
      deliveries++;
    }
    if (deliveries > 0) await this.process();
    return { eventId, deliveries };
  }

  /** Attempt every due delivery (also run by the platform tick route). */
  process(): Promise<void> {
    this.#processing ??= this.#drain().finally(() => {
      this.#processing = undefined;
    });
    return this.#processing;
  }

  async #drain() {
    const due = await this.#store.zdue(QUEUE, Date.now(), 100);
    await Promise.all(due.map((jobId) => this.#attempt(jobId)));
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
    const started = Date.now();
    const res = await this.#post(
      sub.url,
      secrets,
      job.eventId,
      job.body,
      sub.id
    );
    const ok = res.status >= 200 && res.status < 300;
    await this.#record({
      kind: "event",
      eventId: job.eventId,
      name: sub.name,
      subscriptionId: sub.id,
      url: sub.url,
      attempt: job.attempt + 1,
      status: res.status,
      ok,
      error: res.status === 0 ? res.error : ok ? null : `HTTP ${res.status}`,
      started,
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

  #scheduleRetry(delay: number) {
    if (this.#retryTimer !== undefined) return;
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

  /**
   * Serve `GET|POST <base>/_mcp-use/events/tick` and `GET .../health` for
   * the platform wake. Bearer: `MCP_USE_PLATFORM_ADMIN_SECRET` or
   * `CRON_SECRET` (comma-separated lists). Disabled when neither is set.
   * `GET .../admin/subscriptions` and `GET .../admin/deliveries` are
   * read-only views that accept only `MCP_USE_PLATFORM_ADMIN_SECRET`.
   */
  async route(request: Request, action: string): Promise<Response> {
    const e = env();
    const admin = action.startsWith("admin/");
    const accepted = [
      ...list(e.MCP_USE_PLATFORM_ADMIN_SECRET),
      ...(admin ? [] : list(e.CRON_SECRET)),
    ];
    const token = /^Bearer\s+(.+)$/i.exec(
      request.headers.get("authorization") ?? ""
    )?.[1];
    if (accepted.length === 0)
      return new Response("Not Found", { status: 404 });
    if (
      token === undefined ||
      !accepted.some((a) => constantTimeEqual(a, token))
    )
      return Response.json({ error: "unauthorized" }, { status: 401 });
    if (admin && request.method === "GET") {
      if (action === "admin/deliveries") {
        const q = new URL(request.url).searchParams;
        const n = Number(q.get("limit") ?? 50);
        const limit = Number.isFinite(n)
          ? Math.min(Math.max(Math.floor(n), 1), 200)
          : 50;
        const subId = q.get("subscriptionId");
        const deliveries = (await this.#deliveries())
          .filter((d) => !subId || d.subscriptionId === subId)
          .slice(0, limit);
        return Response.json({ deliveries });
      }
      if (action === "admin/subscriptions") {
        const log = await this.#deliveries();
        const ids = new Set<string>();
        for (const name of this.#defs.keys())
          for (const id of await this.#store.smembers(`subs:${name}`))
            ids.add(id);
        const subscriptions = [];
        for (const id of ids) {
          const sub = await this.#getSub(id);
          if (sub === undefined) continue;
          const last = log.find(
            (d) => d.kind === "event" && d.subscriptionId === id
          );
          const iso = (t: number | null | undefined) =>
            t == null ? null : new Date(t).toISOString();
          subscriptions.push({
            id: sub.id,
            name: sub.name,
            arguments: sub.arguments,
            callbackOrigin: originOf(sub.url),
            clientName: sub.clientName ?? null,
            createdAt: iso(sub.createdAt),
            refreshBefore: iso(sub.expiresAt),
            expiresAt: iso(sub.expiresAt),
            lastDelivery: last
              ? { at: last.at, ok: last.ok, status: last.status }
              : null,
          });
        }
        return Response.json({ subscriptions });
      }
    }
    if (action === "health" && request.method === "GET")
      return Response.json({ state: "ok", events: this.#defs.size });
    if (
      action === "tick" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      try {
        await this.process();
        return Response.json({ state: "ok" });
      } catch {
        return Response.json({ state: "degraded" }, { status: 503 });
      }
    }
    return new Response("Not Found", { status: 404 });
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

function principalOf(authInfo: AuthInfo | undefined): string {
  const sub = (authInfo?.extra as { sub?: unknown } | undefined)?.sub;
  if (typeof sub === "string") return `user:${sub}`;
  return authInfo?.clientId ? `client:${authInfo.clientId}` : "anonymous";
}
