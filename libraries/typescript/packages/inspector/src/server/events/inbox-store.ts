/**
 * `StorageEventsInbox` (D71): the Inspector's webhook inbox for MCP Events.
 *
 * One implementation over the `McpUseStorage` contract. Local Inspector hosts
 * use an in-process store; the hosted Inspector uses `MCP_USE_STORAGE_URL`,
 * so any replica can accept a hook and any replica can stream it.
 *
 * Keys (never under `ev:`):
 * - `insp:inbox:{id}`: the inbox record, 24 h, extended on every read or hook
 * - log `insp:inbox:{id}:d`: {@link InboxDelivery} entries, newest 500
 * - `insp:inbox:{id}:seen:{h}`: dedupe marker of `(subId, webhook-id)`, 24 h
 * - `insp:rl:{id}:{minute}`: rate counter (see `rate.ts`)
 * - `insp:count`: live inbox counter
 * - signal channel `insp:wake:{id}`
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { EventEmitter } from "node:events";
import {
  MAX_ENVELOPE_BYTES,
  SUBSCRIPTION_ID_HEADER,
  WEBHOOK_HEADERS,
  WebhookVerificationError,
  generateWebhookSecret,
  verifyWebhook,
} from "@mcp-use/events-core";
import type {
  LogAppendOptions,
  LogAppendResult,
  LogRangeOptions,
  LogRangeResult,
  StorageIncrOptions,
  StorageSignal,
  StorageWriteOptions,
  Versioned,
} from "mcp-use/storage";
import { takeInboxRate } from "./rate.js";

/** Lifetime of an inbox record without activity. */
export const INBOX_TTL_MS = 24 * 60 * 60 * 1000;
/** Deliveries kept per inbox. */
export const INBOX_MAX_DELIVERIES = 500;
/** Live inboxes allowed in a local Inspector. */
export const LOCAL_INBOX_LIMIT = 100;
/** Live inboxes allowed in a hosted Inspector. */
export const HOSTED_INBOX_LIMIT = 10_000;
/** HKDF info string for sealing inbox secrets with `MCP_USE_SECRET`. */
export const INBOX_SEAL_DOMAIN = "mcp-use/inspector-inbox/v1";

/**
 * The subset of `McpUseStorage` the inbox uses. Any `McpUseStorage` adapter
 * satisfies it.
 */
export interface InboxStorage {
  /** Adapter name, for diagnostics. */
  readonly kind: string;
  /** Whether every replica sees the same data. */
  readonly shared: boolean;
  read(key: string): Promise<Versioned | undefined>;
  write(
    key: string,
    value: string,
    options?: StorageWriteOptions
  ): Promise<string | null | void | unknown>;
  remove(key: string): Promise<boolean>;
  incr(key: string, options: StorageIncrOptions): Promise<number>;
  logAppend(
    stream: string,
    value: string,
    options: LogAppendOptions
  ): Promise<LogAppendResult>;
  logRange(stream: string, options: LogRangeOptions): Promise<LogRangeResult>;
  logDelete(stream: string): Promise<void>;
  /** Wake signal; absent means readers tail-poll. */
  signal?: StorageSignal;
}

/** Which client profile the inbox checks deliveries against. */
export type InboxProfile = "auto" | "sep-3415" | "openai";

/** A webhook fault the inbox applies to incoming hooks. */
export type InboxFaultType =
  | "status-500"
  | "status-410"
  | "status-413"
  | "redirect-307"
  | "timeout"
  | "slow-ack"
  | "pending-503"
  | "bad-challenge"
  | "echo-body";

/** A fault preset set with `PATCH …/inboxes/:id`. */
export interface FaultPreset {
  /** The fault. */
  type: InboxFaultType;
  /** How many more hooks it applies to; absent means every hook. */
  remaining?: number;
  /** Delay for `timeout` and `slow-ack`, in milliseconds. */
  delayMs?: number;
}

/** One check the inbox ran on a delivery. */
export interface InboxCheck {
  /** Stable check id, e.g. `signature`. */
  id: string;
  /** How strongly the spec requires it. */
  level: "MUST" | "SHOULD" | "INFO";
  /** Whether the delivery passed. */
  ok: boolean;
  /** Human-readable detail. */
  detail?: string;
}

/** One hook received by an inbox, as stored in its log and streamed over SSE. */
export interface InboxDelivery {
  v: 1;
  /** ISO time the hook arrived. */
  receivedAt: string;
  /** What the body is. */
  kind: "verification" | "event" | "gap" | "terminated" | "unknown";
  /** Selected request headers; the signature is truncated. */
  headers: Record<string, string>;
  /** Raw body bytes, base64. */
  body: string;
  /** What the inbox answered. */
  response: { status: number; faultApplied?: string };
  /** Checks run on the delivery. */
  checks: InboxCheck[];
}

/** A delivery with its log position. */
export interface InboxLogEntry {
  /** Position in the inbox log; pass it as `after` to resume. */
  seq: number;
  /** The delivery. */
  delivery: InboxDelivery;
}

interface InboxRecord {
  v: 1;
  id: string;
  createdAt: string;
  secret: string;
  previousSecret?: string;
  previousSecretUntil?: number;
  readTokenHash: string;
  fault: FaultPreset | null;
  profile: InboxProfile;
  lastSeenAt: string;
}

/** Public view of an inbox (never includes the read token). */
export interface InboxInfo {
  inboxId: string;
  secret: string;
  profile: InboxProfile;
  fault: FaultPreset | null;
  createdAt: string;
}

/** What {@link StorageEventsInbox.create} returns. */
export interface CreatedInbox extends InboxInfo {
  /** Bearer token for reading, patching and deleting the inbox. */
  readToken: string;
}

/** Changes accepted by {@link StorageEventsInbox.update}. */
export interface InboxPatch {
  /** Mint a new secret; the previous one stays valid for 24 h. */
  rotateSecret?: boolean;
  /** Set (or clear with `null`) the fault preset. */
  fault?: FaultPreset | null;
  /** The profile deliveries are checked against. */
  profile?: InboxProfile;
}

/** The inbox's answer to a hook. */
export interface HookResult {
  status: number;
  /** JSON body, or `undefined` for an empty body. */
  body?: unknown;
  /** Extra response headers. */
  headers?: Record<string, string>;
  /** The stored delivery; absent for an unknown inbox or a dedupe hit. */
  delivery?: InboxDelivery;
  /** Whether the hook was a duplicate `(subId, webhook-id)`. */
  duplicate?: boolean;
}

/** Thrown by {@link StorageEventsInbox.create} past the live-inbox bound. */
export class InboxLimitError extends Error {
  constructor(limit: number) {
    super(`at most ${limit} inboxes may be live at once`);
    this.name = "InboxLimitError";
  }
}

/** Options for {@link StorageEventsInbox}. */
export interface StorageEventsInboxOptions {
  /** The store. */
  storage: InboxStorage;
  /** `MCP_USE_SECRET`: seals stored inbox secrets when set. */
  sealSecret?: string;
  /** Bound on live inboxes; default 100, or 10,000 on a shared store. */
  maxInboxes?: number;
  /** Clock, for tests. */
  now?: () => number;
  /** Sleep used by the `timeout` and `slow-ack` faults, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const recordKey = (id: string) => `insp:inbox:${id}`;
const logKey = (id: string) => `insp:inbox:${id}:d`;
/** Signal channel woken on every delivery to inbox `id`. */
export const inboxWakeChannel = (id: string) => `insp:wake:${id}`;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const toB64Url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** Whether `id` has the shape of an inbox id. */
export function isInboxId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/**
 * The Inspector's Events inbox over `McpUseStorage` (D71).
 */
export class StorageEventsInbox {
  /** The store, exposed for the SSE reader. */
  readonly storage: InboxStorage;
  readonly #sealKey: Buffer | undefined;
  readonly #max: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  /**
   * @param options - Store, sealing secret and bounds.
   */
  constructor(options: StorageEventsInboxOptions) {
    this.storage = options.storage;
    this.#sealKey = options.sealSecret
      ? Buffer.from(
          hkdfSync(
            "sha256",
            options.sealSecret,
            Buffer.alloc(0),
            INBOX_SEAL_DOMAIN,
            32
          )
        )
      : undefined;
    this.#max =
      options.maxInboxes ??
      (options.storage.shared ? HOSTED_INBOX_LIMIT : LOCAL_INBOX_LIMIT);
    this.#now = options.now ?? Date.now;
    this.#sleep =
      options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Creates an inbox with a fresh 128-bit id, webhook secret and read token.
   *
   * @param profile - The profile to check deliveries against.
   * @returns The inbox and its read token.
   * @throws InboxLimitError past the live-inbox bound.
   */
  async create(profile: InboxProfile = "auto"): Promise<CreatedInbox> {
    const live = await this.storage.incr("insp:count", { ttlMs: INBOX_TTL_MS });
    if (live > this.#max) {
      await this.storage.incr("insp:count", { ttlMs: INBOX_TTL_MS, by: -1 });
      throw new InboxLimitError(this.#max);
    }
    const id = toB64Url(randomBytes(16));
    const readToken = `ibx_${toB64Url(randomBytes(32))}`;
    const now = new Date(this.#now()).toISOString();
    const record: InboxRecord = {
      v: 1,
      id,
      createdAt: now,
      secret: generateWebhookSecret(),
      readTokenHash: sha256(readToken),
      fault: null,
      profile,
      lastSeenAt: now,
    };
    await this.#save(record);
    return { ...this.#info(record), readToken };
  }

  /**
   * Checks a read token against an inbox.
   *
   * @returns The inbox, or `undefined` when absent or the token is wrong.
   */
  async authorize(
    id: string,
    readToken: string | undefined
  ): Promise<InboxInfo | undefined> {
    if (!readToken || !isInboxId(id)) return undefined;
    const record = await this.#load(id);
    if (!record) return undefined;
    const a = Buffer.from(record.readTokenHash, "hex");
    const b = Buffer.from(sha256(readToken), "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
    record.lastSeenAt = new Date(this.#now()).toISOString();
    await this.#save(record);
    return this.#info(record);
  }

  /**
   * Rotates the secret, sets the fault preset or the profile.
   *
   * @returns The updated inbox, or `undefined` when absent.
   */
  async update(id: string, patch: InboxPatch): Promise<InboxInfo | undefined> {
    const record = await this.#load(id);
    if (!record) return undefined;
    if (patch.rotateSecret) {
      record.previousSecret = record.secret;
      record.previousSecretUntil = this.#now() + INBOX_TTL_MS;
      record.secret = generateWebhookSecret();
    }
    if (patch.fault !== undefined) record.fault = patch.fault;
    if (patch.profile !== undefined) record.profile = patch.profile;
    await this.#save(record);
    return this.#info(record);
  }

  /**
   * Removes the inbox record and its log.
   *
   * @returns Whether an inbox was removed.
   */
  async delete(id: string): Promise<boolean> {
    const removed = await this.storage.remove(recordKey(id));
    await this.storage.logDelete(logKey(id));
    if (removed) {
      await this.storage.incr("insp:count", { ttlMs: INBOX_TTL_MS, by: -1 });
    }
    return removed;
  }

  /**
   * Reads deliveries after `after`, oldest first.
   *
   * @param id - The inbox.
   * @param after - Last seq the reader has, or `null` for the start.
   * @param limit - Page size.
   */
  async read(
    id: string,
    after: number | null,
    limit = 100
  ): Promise<{ entries: InboxLogEntry[]; head: number }> {
    const page = await this.storage.logRange(logKey(id), { after, limit });
    const entries: InboxLogEntry[] = [];
    for (const e of page.entries) {
      try {
        entries.push({ seq: e.seq, delivery: JSON.parse(e.value) });
      } catch {
        // a corrupt entry is skipped, never fatal to the stream
      }
    }
    return { entries, head: page.head };
  }

  /**
   * Handles one hook POST: rate limit, size, HMAC over the raw bytes, the
   * verification echo, fault presets, dedupe and checks. A signature failure
   * is a stored check row and a 401, never a 5xx.
   *
   * @param id - The inbox id from the path.
   * @param headers - The request headers.
   * @param body - The raw body bytes as received (`undefined` when it was
   *   over the size cap and not read).
   * @param declaredSize - The body size when `body` is `undefined`.
   */
  async receive(
    id: string,
    headers: Headers,
    body: Uint8Array | undefined,
    declaredSize?: number
  ): Promise<HookResult> {
    if (!isInboxId(id))
      return { status: 404, body: { error: "unknown inbox" } };
    const record = await this.#load(id);
    if (!record) return { status: 404, body: { error: "unknown inbox" } };

    const rate = await takeInboxRate(this.storage, id, this.#now());
    if (!rate.allowed) {
      return {
        status: 429,
        body: { error: "rate limited" },
        headers: { "Retry-After": String(rate.retryAfterSec) },
      };
    }

    const checks: InboxCheck[] = [];
    const size = body?.byteLength ?? declaredSize ?? 0;
    const sizeOk = body !== undefined && size <= MAX_ENVELOPE_BYTES;
    checks.push({
      id: "size",
      level: "MUST",
      ok: sizeOk,
      detail: `${size} B (limit ${MAX_ENVELOPE_BYTES} B)`,
    });

    const webhookId = headers.get(WEBHOOK_HEADERS.id) ?? undefined;
    const subId = headers.get(SUBSCRIPTION_ID_HEADER) ?? undefined;
    checks.push({
      id: "webhook-id",
      level: "MUST",
      ok: Boolean(webhookId),
      detail: webhookId ?? "missing",
    });
    checks.push({
      id: "subscription-id-header",
      level: "MUST",
      ok: Boolean(subId),
      detail: subId ?? `missing ${SUBSCRIPTION_ID_HEADER}`,
    });

    let signatureOk = false;
    if (body !== undefined) {
      const secrets = [record.secret];
      if (
        record.previousSecret &&
        (record.previousSecretUntil ?? 0) > this.#now()
      ) {
        secrets.push(record.previousSecret);
      }
      try {
        await verifyWebhook({ secrets, headers, body, now: this.#now() });
        signatureOk = true;
        checks.push({ id: "signature", level: "MUST", ok: true });
        checks.push({ id: "timestamp", level: "MUST", ok: true });
      } catch (error) {
        const reason =
          error instanceof WebhookVerificationError ? error.reason : "error";
        const tsFail =
          reason === "timestamp_out_of_tolerance" ||
          reason === "invalid_timestamp";
        checks.push({
          id: "signature",
          level: "MUST",
          ok: false,
          detail: tsFail ? "not checked: bad timestamp" : reason,
        });
        checks.push({
          id: "timestamp",
          level: "MUST",
          ok: !tsFail,
          detail: tsFail ? reason : undefined,
        });
      }
    }

    let parsed: Record<string, unknown> | undefined;
    if (body !== undefined && sizeOk) {
      try {
        const value = JSON.parse(new TextDecoder().decode(body));
        if (value && typeof value === "object" && !Array.isArray(value)) {
          parsed = value as Record<string, unknown>;
        }
      } catch {
        // reported by the json check
      }
      checks.push({ id: "json", level: "MUST", ok: parsed !== undefined });
    }
    const kind = deliveryKind(parsed);
    if (kind === "event" && parsed) {
      checks.push(...eventChecks(parsed, webhookId, record.profile));
    }

    // Decide the response.
    let status: number;
    let responseBody: unknown;
    let faultApplied: string | undefined;
    const extraHeaders: Record<string, string> = {};
    if (!sizeOk) {
      status = 413;
      responseBody = { error: "payload too large" };
    } else if (!signatureOk) {
      status = 401;
      responseBody = { error: "invalid signature" };
    } else {
      status = 200;
      responseBody =
        kind === "verification" ? { challenge: parsed?.challenge } : {};
      const fault = record.fault;
      if (fault && (fault.remaining === undefined || fault.remaining > 0)) {
        const applied = await this.#applyFault(fault, kind, parsed);
        if (applied) {
          faultApplied = fault.type;
          status = applied.status;
          responseBody = applied.body;
          Object.assign(extraHeaders, applied.headers);
          if (fault.remaining !== undefined) {
            record.fault =
              fault.remaining > 1
                ? { ...fault, remaining: fault.remaining - 1 }
                : null;
          }
        }
      }
    }

    const delivery: InboxDelivery = {
      v: 1,
      receivedAt: new Date(this.#now()).toISOString(),
      kind,
      headers: pickHeaders(headers),
      body: body && sizeOk ? Buffer.from(body).toString("base64") : "",
      response: faultApplied ? { status, faultApplied } : { status },
      checks,
    };
    const appendOptions: LogAppendOptions = {
      maxEvents: INBOX_MAX_DELIVERIES,
      notify: inboxWakeChannel(id),
    };
    if (signatureOk && webhookId && !faultApplied) {
      appendOptions.dedupe = {
        key: `insp:inbox:${id}:seen:${sha256(`${subId ?? ""}\u0000${webhookId}`).slice(0, 32)}`,
        ttlMs: INBOX_TTL_MS,
      };
    }
    const appended = await this.storage.logAppend(
      logKey(id),
      JSON.stringify(delivery),
      appendOptions
    );
    if (!appended.duplicate && this.storage.signal) {
      // `notify` covers adapters that publish inside logAppend; an explicit
      // publish covers the ones that do not. Readers tolerate double wakes.
      await this.storage.signal
        .publish(inboxWakeChannel(id), String(appended.seq))
        .catch(() => undefined);
    }
    record.lastSeenAt = delivery.receivedAt;
    await this.#save(record);
    return {
      status,
      body: responseBody,
      headers: extraHeaders,
      delivery: appended.duplicate ? undefined : delivery,
      duplicate: appended.duplicate,
    };
  }

  async #applyFault(
    fault: FaultPreset,
    kind: InboxDelivery["kind"],
    parsed: Record<string, unknown> | undefined
  ): Promise<
    | { status: number; body: unknown; headers?: Record<string, string> }
    | undefined
  > {
    switch (fault.type) {
      case "status-500":
        return { status: 500, body: { error: "injected fault" } };
      case "status-410":
        return { status: 410, body: { error: "injected fault" } };
      case "status-413":
        return { status: 413, body: { error: "injected fault" } };
      case "redirect-307":
        return {
          status: 307,
          body: undefined,
          headers: { Location: "https://example.invalid/redirected" },
        };
      case "timeout":
        await this.#sleep(fault.delayMs ?? 30_000);
        return {
          status: 200,
          body: kind === "verification" ? { challenge: parsed?.challenge } : {},
        };
      case "slow-ack":
        await this.#sleep(fault.delayMs ?? 5_000);
        return {
          status: 200,
          body: kind === "verification" ? { challenge: parsed?.challenge } : {},
        };
      case "pending-503":
        return kind === "verification"
          ? { status: 503, body: { error: "injected fault" } }
          : undefined;
      case "bad-challenge":
        return kind === "verification"
          ? { status: 200, body: { challenge: "wrong-challenge" } }
          : undefined;
      case "echo-body":
        return { status: 200, body: parsed };
      default:
        return undefined;
    }
  }

  #info(record: InboxRecord): InboxInfo {
    return {
      inboxId: record.id,
      secret: record.secret,
      profile: record.profile,
      fault: record.fault,
      createdAt: record.createdAt,
    };
  }

  async #load(id: string): Promise<InboxRecord | undefined> {
    const raw = await this.storage.read(recordKey(id));
    if (!raw) return undefined;
    try {
      const stored = JSON.parse(raw.value) as InboxRecord;
      return {
        ...stored,
        secret: this.#open(stored.secret),
        previousSecret: stored.previousSecret
          ? this.#open(stored.previousSecret)
          : undefined,
      };
    } catch {
      return undefined;
    }
  }

  async #save(record: InboxRecord): Promise<void> {
    const stored: InboxRecord = {
      ...record,
      secret: this.#seal(record.secret),
      previousSecret: record.previousSecret
        ? this.#seal(record.previousSecret)
        : undefined,
    };
    await this.storage.write(recordKey(record.id), JSON.stringify(stored), {
      ttlMs: INBOX_TTL_MS,
    });
  }

  #seal(plain: string): string {
    if (!this.#sealKey) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#sealKey, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `sealed:v1:${Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64url")}`;
  }

  #open(value: string): string {
    if (!value.startsWith("sealed:v1:")) return value;
    if (!this.#sealKey) throw new Error("inbox record is sealed");
    const raw = Buffer.from(value.slice(10), "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#sealKey,
      raw.subarray(0, 12)
    );
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]).toString("utf8");
  }
}

function deliveryKind(
  parsed: Record<string, unknown> | undefined
): InboxDelivery["kind"] {
  if (!parsed) return "unknown";
  if (parsed.type === "verification") return "verification";
  if (parsed.type === "gap") return "gap";
  if (parsed.type === "terminated") return "terminated";
  if (typeof parsed.eventId === "string" && typeof parsed.name === "string") {
    return "event";
  }
  return "unknown";
}

function eventChecks(
  body: Record<string, unknown>,
  webhookId: string | undefined,
  profile: InboxProfile
): InboxCheck[] {
  const checks: InboxCheck[] = [];
  checks.push({
    id: "cursor-field",
    level: "MUST",
    ok: "cursor" in body,
    detail: "webhook event bodies carry `cursor` (string or null)",
  });
  checks.push({
    id: "timestamp-field",
    level: "MUST",
    ok: typeof body.timestamp === "string",
  });
  // ChatGPT dedupes on `webhook-id`, so under its profile the id must be
  // stable per event; SEP-3415 only requires stability across retries.
  const equal = webhookId !== undefined && webhookId === body.eventId;
  checks.push({
    id: "webhook-id-vs-eventId",
    level: profile === "openai" ? "SHOULD" : "INFO",
    ok: profile === "openai" ? equal : true,
    detail: equal
      ? "webhook-id equals eventId"
      : `webhook-id ${webhookId ?? "missing"} differs from eventId ${String(body.eventId)}`,
  });
  return checks;
}

const KEPT_HEADERS = [
  WEBHOOK_HEADERS.id,
  WEBHOOK_HEADERS.timestamp,
  WEBHOOK_HEADERS.signature,
  SUBSCRIPTION_ID_HEADER.toLowerCase(),
  "content-type",
  "user-agent",
];

function pickHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);
    if (value === null) continue;
    out[name] =
      name === WEBHOOK_HEADERS.signature && value.length > 24
        ? `${value.slice(0, 24)}…`
        : value;
  }
  return out;
}

/**
 * The in-process inbox store used by local Inspector hosts (one process).
 *
 * TODO(events): switch to `memoryStorage()` from `mcp-use/storage` once its
 * memory adapter implements the full `McpUseStorage` log contract (WP-02);
 * this keeps the local inbox working until then and has the same semantics.
 */
export function localInboxStorage(now: () => number = Date.now): InboxStorage {
  const values = new Map<
    string,
    { value: string; version: number; exp: number }
  >();
  const logs = new Map<
    string,
    { epoch: string; head: number; entries: { seq: number; value: string }[] }
  >();
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  let version = 0;
  const get = (key: string) => {
    const e = values.get(key);
    if (!e) return undefined;
    if (e.exp <= now()) {
      values.delete(key);
      return undefined;
    }
    return e;
  };
  const signal: StorageSignal = {
    async publish(channel, message) {
      bus.emit(channel, message);
    },
    async subscribe(channel, onMessage) {
      bus.on(channel, onMessage);
      return async () => {
        bus.off(channel, onMessage);
      };
    },
  };
  return {
    kind: "memory",
    shared: false,
    signal,
    async read(key) {
      const e = get(key);
      return e ? { value: e.value, version: String(e.version) } : undefined;
    },
    async write(key, value, options) {
      version += 1;
      values.set(key, {
        value,
        version,
        exp: options?.ttlMs ? now() + options.ttlMs : Number.POSITIVE_INFINITY,
      });
      return String(version);
    },
    async remove(key) {
      return values.delete(key);
    },
    async incr(key, options) {
      const e = get(key);
      const next = (e ? Number(e.value) : 0) + (options.by ?? 1);
      version += 1;
      values.set(key, {
        value: String(next),
        version,
        exp: e?.exp ?? now() + options.ttlMs,
      });
      return next;
    },
    async logAppend(stream, value, options) {
      if (options.dedupe) {
        const seen = get(options.dedupe.key);
        if (seen) return { duplicate: true, seq: Number(seen.value) };
      }
      let log = logs.get(stream);
      if (!log) {
        log = { epoch: toB64Url(randomBytes(6)), head: 0, entries: [] };
        logs.set(stream, log);
      }
      log.head += 1;
      log.entries.push({ seq: log.head, value });
      if (log.entries.length > options.maxEvents) {
        log.entries.splice(0, log.entries.length - options.maxEvents);
      }
      if (options.dedupe) {
        version += 1;
        values.set(options.dedupe.key, {
          value: String(log.head),
          version,
          exp: now() + options.dedupe.ttlMs,
        });
      }
      return { duplicate: false, seq: log.head, epoch: log.epoch };
    },
    async logRange(stream, options) {
      const log = logs.get(stream);
      if (!log) return { entries: [], epoch: null, first: 1, head: 0 };
      const after = options.after ?? 0;
      return {
        entries: log.entries
          .filter((e) => e.seq > after)
          .slice(0, options.limit),
        epoch: log.epoch,
        first: log.entries[0]?.seq ?? log.head + 1,
        head: log.head,
      };
    },
    async logDelete(stream) {
      logs.delete(stream);
    },
  };
}

/**
 * Opens the inbox store for this Inspector host: `MCP_USE_STORAGE_URL`
 * (hosted, shared across replicas) when set, else {@link localInboxStorage}.
 * A hosted store requires `MCP_USE_SECRET` to seal inbox secrets.
 *
 * @param env - Environment variables; default `process.env`.
 * @throws When a store URL is set without `MCP_USE_SECRET`, or the store
 *   does not implement the log contract.
 */
export async function openInboxFromEnv(
  env: Record<string, string | undefined> = process.env
): Promise<StorageEventsInbox> {
  const url = env.MCP_USE_STORAGE_URL;
  if (!url) return new StorageEventsInbox({ storage: localInboxStorage() });
  const sealSecret = env.MCP_USE_SECRET;
  if (!sealSecret) {
    throw new Error(
      "MCP_USE_STORAGE_URL is set but MCP_USE_SECRET is not: the hosted Inspector inbox seals inbox secrets with it"
    );
  }
  // TODO(events): `parseStorageUrl` / `openStorageUrl` are not yet exported
  // from `mcp-use/storage` (WP-02 owns that export map); they are looked up
  // at runtime so the hosted inbox works as soon as they are.
  const mod = (await import("mcp-use/storage")) as Record<string, unknown>;
  const parse = mod.parseStorageUrl as
    | ((e: Record<string, string | undefined>) => unknown)
    | undefined;
  const open = mod.openStorageUrl as
    | ((target: unknown) => Promise<unknown>)
    | undefined;
  if (!parse || !open) {
    throw new Error(
      "this mcp-use version cannot open MCP_USE_STORAGE_URL (mcp-use/storage lacks openStorageUrl)"
    );
  }
  const storage = (await open(parse(env))) as InboxStorage;
  if (typeof storage.logAppend !== "function") {
    throw new Error(
      `the store at MCP_USE_STORAGE_URL (${storage.kind ?? "unknown"}) does not implement the McpUseStorage log contract`
    );
  }
  return new StorageEventsInbox({ storage, sealSecret });
}
