/**
 * Delivery: one client per (endpoint, key) pair, shared by every server
 * instance in the process (per-request servers included). Events wait in a
 * bounded queue, are serialized at flush time, and are POSTed in batches with
 * retries. Nothing here runs on a request's critical path except `enqueue`,
 * which is O(1).
 *
 * Capture settings come from `GET /v1/config` and from every `202`. Events
 * are serialized with the settings in hand, so before serializing, the client
 * asks `GET /v1/config` again when they are more than a minute old: a
 * dashboard change applies to the next batch, not to the one after it.
 */

import {
  monotonicNow,
  runtimeName,
  unrefTimeout,
  type WaitUntil,
} from "./runtime.js";
import {
  WIRE_SCHEMA,
  type AnalyticsBatch,
  type AnalyticsEvent,
  type Framework,
  type RemoteConfig,
} from "./types.js";

declare const __MCP_USE_ANALYTICS_VERSION__: string;

/** Package name sent as `sdk.name`. */
const SDK_NAME = "@mcp-use/analytics";

/** Package version sent as `sdk.version`. */
const SDK_VERSION =
  typeof __MCP_USE_ANALYTICS_VERSION__ === "undefined"
    ? "0.0.0-dev"
    : __MCP_USE_ANALYTICS_VERSION__;

/** The ingest endpoint caps a batch at 500 events and 1 MB. */
const MAX_EVENTS_PER_BATCH = 500;
const MAX_BATCH_BYTES = 900_000;
/**
 * A batch is dropped after this many failed attempts (network errors, `408`,
 * `5xx`, `retryable` rejections, a `429` without `Retry-After`). The waits in
 * between, 0.5 s doubling and each jittered to 50-100 %, add up to about
 * 30-60 s. The Python SDK uses the same budget and schedule.
 */
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** Bound of the first `GET /v1/config`, which the first batch waits for. */
const CONFIG_WAIT_MS = 3_000;
/**
 * Capture settings older than this (no `GET /v1/config` answer and no `202`
 * in that time) are fetched again before events are serialized: the
 * dashboard promises changes reach the SDK within about a minute. A failed
 * fetch is not tried again for this long either. The Python SDK uses the
 * same age.
 */
const CONFIG_MAX_AGE_MS = 60_000;
/**
 * Bound of a refresh: it holds serialization back while the last settings
 * are still usable, so it gets less than the first fetch.
 */
const CONFIG_REFRESH_TIMEOUT_MS = 2_000;
const PAYMENT_PAUSE_MS = 10 * 60_000;
/** Longest wait a `Retry-After` can impose (after a `429`, on the whole client). */
const MAX_RETRY_AFTER_MS = 10 * 60_000;
/** Shortest pause after a `429`, so `Retry-After: 0` cannot make sending spin. */
const MIN_RATE_LIMIT_PAUSE_MS = 1_000;
/**
 * Longest one serialization may take. User hooks are bounded on their own
 * (2 s, record.ts); this only guarantees a pass always ends.
 */
const SERIALIZE_TIMEOUT_MS = 5_000;
/**
 * Total time the exit flush (`beforeExit`, or a SIGINT/SIGTERM nothing else
 * handles) may keep a finishing process alive: one attempt per batch, no
 * retries.
 */
export const EXIT_FLUSH_MS = 2_000;
/** Longest `flush()` waits for responses an adapter is still reading. */
const TRACKED_WAIT_MS = 1_000;
const LOG_PREFIX = "[@mcp-use/analytics]";

/** Capture settings assumed until the endpoint has answered: nothing optional is sent. */
const PRIVATE_CONFIG: RemoteConfig = {
  capture_payloads: false,
  identify_actors: false,
};

/** Where an event came from; events are grouped into one batch per source. */
export interface EventSource {
  /** Framework label sent as `sdk.framework`. */
  framework: Framework;
  /** The instrumented server's `serverInfo`, when known. */
  server?: { name?: string; version?: string };
}

/** An event whose wire form is built at flush time, off the request path. */
export interface PendingEvent {
  /** Batch grouping. */
  readonly source: EventSource;
  /** Build the wire event for the current capture settings; `null` drops it. */
  toWire(config: RemoteConfig): Promise<AnalyticsEvent | null>;
}

/** Resolved delivery settings of one client. */
export interface ClientSettings {
  apiKey: string;
  endpoint: string;
  debug: boolean;
  flushIntervalMs: number;
  maxBatchSize: number;
  maxQueueSize: number;
}

interface ReadyBatch {
  /** Serialized envelope (`{"schema":…,"sdk":…}`). */
  head: string;
  /** Serialized events, so a partial retry or a 413 split resends a subset. */
  events: string[];
  source: EventSource;
  attempts: number;
  notBefore: number;
  /** Drain pass that last attempted this batch. */
  pass: number;
}

/** A `flush()` / `waitUntil` promise, resolved once pass `pass` finished. */
interface DrainWaiter {
  pass: number;
  resolve: () => void;
}

/** One `POST /v1/events` body. */
function batchBody(batch: ReadyBatch): string {
  return `${batch.head.slice(0, -1)},"events":[${batch.events.join(",")}]}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lifecycle of a client. */
type ClientState = "active" | "unauthorized" | "shutdown";

/** What the endpoint answered, body already read. */
interface EndpointReply {
  status: number;
  retryAfter: string | null;
  body: unknown;
}

/** Rough UTF-8 byte length without allocating. */
function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** A `Retry-After` header in milliseconds, at most {@link MAX_RETRY_AFTER_MS}. */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seconds = Number(value);
  let ms: number;
  if (Number.isFinite(seconds) && seconds >= 0) {
    ms = seconds * 1000;
  } else {
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    ms = Math.max(0, date - Date.now());
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

function readConfig(body: unknown): RemoteConfig | undefined {
  if (!isRecord(body)) return undefined;
  const config = (body as { config?: unknown }).config;
  if (typeof config !== "object" || config === null) return undefined;
  const record = config as Record<string, unknown>;
  return {
    capture_payloads: record["capture_payloads"] === true,
    identify_actors: record["identify_actors"] === true,
  };
}

function backoff(attempts: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempts - 1));
  return exp / 2 + Math.random() * (exp / 2);
}

/** One delivery pipeline for one analytics key. */
export class AnalyticsClient {
  /** Delivery settings, fixed when the client is created. */
  readonly settings: ClientSettings;
  #state: ClientState = "active";
  #pending: PendingEvent[] = [];
  #ready: ReadyBatch[] = [];
  #config: RemoteConfig | undefined;
  #configFetch: Promise<void> | undefined;
  /**
   * {@link clock} time when the settings last arrived (`GET /v1/config` or a
   * `202`) or were last asked for; undefined until the first request.
   */
  #configCheckedAt: number | undefined;
  /** `202`s that carried settings so far; a `GET` answer older than one is ignored. */
  #postedConfigs = 0;
  #pausedUntil = 0;
  /** A `429` pauses every send until then; events keep buffering. */
  #holdUntil = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #timerDueAt = 0;
  #running: Promise<void> | undefined;
  /** Drain passes started so far. */
  #passes = 0;
  #waiters: DrainWaiter[] = [];
  #forceNext = false;
  /** Set during the exit flush: one bounded attempt, nothing is re-queued. */
  #finalBy: number | undefined;
  /**
   * Exit and signal flushes in progress: while any is, events are serialized
   * at once (unknown capture settings send nothing optional) instead of
   * waiting for `GET /v1/config`.
   */
  #urgent = 0;
  /** Ends a serialization's wait for the capture settings early. */
  #wakeConfigWait: (() => void) | undefined;
  #soon: Promise<void> | undefined;
  #tracked = new Set<Promise<void>>();
  #dropped = 0;
  #warned = new Set<string>();
  /**
   * Monotonic clock in milliseconds that ages the capture settings
   * ({@link CONFIG_MAX_AGE_MS}); tests replace it.
   */
  clock: () => number = monotonicNow;

  /** Create a client; it does no I/O until the first event is queued. */
  constructor(settings: ClientSettings) {
    this.settings = settings;
  }

  /** Whether events are queued or waiting for a retry. */
  get hasWork(): boolean {
    return this.#hasWork();
  }

  /** Whether events are being accepted (not stopped by a 401, a 402 pause, or shutdown). */
  get active(): boolean {
    return this.#state === "active" && Date.now() >= this.#pausedUntil;
  }

  /** `active`, `unauthorized` (stopped by a 401) or `shutdown`. */
  get state(): ClientState {
    return this.#state;
  }

  /** Last capture settings from the endpoint, if any arrived yet. */
  get remoteConfig(): RemoteConfig | undefined {
    return this.#config;
  }

  /** Whether payloads might be captured (unknown settings count as maybe). */
  get mayCapturePayloads(): boolean {
    return this.#config === undefined || this.#config.capture_payloads;
  }

  /** Log only when `debug` is on. */
  debug(message: string, detail?: unknown): void {
    if (!this.settings.debug) return;
    if (detail === undefined) console.debug(`${LOG_PREFIX} ${message}`);
    else console.debug(`${LOG_PREFIX} ${message}`, detail);
  }

  /** Warn once per distinct key for the lifetime of the client. */
  warnOnce(key: string, message: string): void {
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    console.warn(`${LOG_PREFIX} ${message}`);
  }

  /**
   * Queue an event. Never throws and never blocks; drops the oldest event
   * when the queue is full.
   */
  enqueue(event: PendingEvent, waitUntil?: WaitUntil): void {
    if (!this.active) return;
    this.#pending.push(event);
    const queued = this.#queuedCount();
    if (queued > this.settings.maxQueueSize) {
      this.#dropOldest(queued - this.settings.maxQueueSize);
    }
    if (this.#config === undefined) void this.#loadConfig();

    if (waitUntil !== undefined) {
      try {
        waitUntil(this.#flushSoon());
      } catch (error) {
        this.debug("waitUntil threw", error);
      }
      return;
    }
    if (this.#pending.length >= this.settings.maxBatchSize) {
      void this.#flushSoon();
      return;
    }
    this.#schedule(this.settings.flushIntervalMs);
  }

  /**
   * Send everything queued now, ignoring retry backoff (but not a `429`'s
   * `Retry-After`). Resolves (never rejects) once every event queued before
   * the call was attempted; responses an adapter is still reading (their
   * events are about to be queued) are waited for up to a second first.
   */
  async flush(): Promise<void> {
    if (this.#tracked.size > 0) await this.#waitForTracked();
    return this.#drain(true);
  }

  /**
   * Work that is about to queue events, such as an HTTP response an adapter
   * is reading in the background; `flush()` waits for it briefly.
   */
  track(work: Promise<unknown>): void {
    const settled = work.then(
      () => undefined,
      () => undefined
    );
    this.#tracked.add(settled);
    void settled.then(() => this.#tracked.delete(settled));
  }

  /**
   * The flush run when the process is about to end: the event loop emptied
   * (`beforeExit`), or a SIGINT/SIGTERM arrived that nothing else handles.
   * One attempt per queued batch within {@link EXIT_FLUSH_MS} in total, no
   * retries, no backoff, so a stalled endpoint cannot keep a finished process
   * alive, and no wait for the capture settings: while they are unknown,
   * events are sent without optional fields. Whatever is not delivered by
   * then is dropped.
   */
  async flushOnExit(): Promise<void> {
    return this.#flushNow(true);
  }

  /**
   * The flush run on a SIGINT/SIGTERM the application handles itself (it
   * decides when to exit, and may call `process.exit()` soon): sending starts
   * at once, without waiting for the capture settings, joining a flush
   * already in progress. Failed batches are retried as usual.
   */
  async flushOnSignal(): Promise<void> {
    return this.#flushNow(false);
  }

  async #flushNow(final: boolean): Promise<void> {
    if (
      this.#state !== "active" ||
      (!this.#hasWork() && this.#running === undefined)
    ) {
      return;
    }
    this.#clearTimer();
    this.#urgent += 1;
    this.#wakeConfigWait?.();
    if (final) this.#finalBy ??= Date.now() + EXIT_FLUSH_MS;
    // Hold the process for the final attempt; every wait inside is bounded
    // by `#finalBy`, and the other timers are unref'd.
    const keepAlive = final
      ? setTimeout(() => undefined, EXIT_FLUSH_MS)
      : undefined;
    try {
      await this.#drain(true);
    } finally {
      if (keepAlive !== undefined) clearTimeout(keepAlive);
      this.#urgent -= 1;
      if (final) this.#finalBy = undefined;
    }
  }

  /** Flush, then stop accepting events. */
  async shutdown(): Promise<void> {
    if (this.#state === "shutdown") return;
    await this.flush();
    this.#state = "shutdown";
    this.#clearTimer();
    this.#pending = [];
    this.#ready = [];
  }

  #queuedCount(): number {
    let count = this.#pending.length;
    for (const batch of this.#ready) count += batch.events.length;
    return count;
  }

  #hasWork(): boolean {
    return this.#pending.length > 0 || this.#ready.length > 0;
  }

  #dropOldest(count: number): void {
    let remaining = count;
    while (remaining > 0 && this.#ready.length > 0) {
      const batch = this.#ready.shift()!;
      remaining -= batch.events.length;
      this.#dropped += batch.events.length;
    }
    if (remaining > 0) {
      this.#pending.splice(0, remaining);
      this.#dropped += remaining;
    }
    this.debug(
      `queue full (${this.settings.maxQueueSize}); dropped ${count} oldest event(s), ${this.#dropped} in total`
    );
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#timerDueAt = 0;
  }

  #schedule(delayMs: number): void {
    if (this.#state !== "active") return;
    const dueAt = Date.now() + delayMs;
    // A timer that is long overdue was frozen with its isolate (Workers,
    // serverless); replace it instead of trusting it to fire.
    const stale =
      this.#timer !== undefined &&
      Date.now() > this.#timerDueAt + Math.max(1000, delayMs);
    if (this.#timer !== undefined && !stale && this.#timerDueAt <= dueAt) {
      return;
    }
    this.#clearTimer();
    this.#timerDueAt = dueAt;
    this.#timer = unrefTimeout(() => {
      this.#timer = undefined;
      this.#timerDueAt = 0;
      void this.#drain(false);
    }, delayMs);
  }

  /** A flush on the next macrotask, coalescing everything queued this tick. */
  #flushSoon(): Promise<void> {
    this.#soon ??= new Promise<void>((resolve) => {
      setTimeout(() => {
        this.#soon = undefined;
        void this.#drain(false).then(resolve);
      }, 0);
    });
    return this.#soon;
  }

  #waitForTracked(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      Promise.all(this.#tracked).then(() => undefined),
      new Promise<void>((resolve) => {
        timer = unrefTimeout(resolve, TRACKED_WAIT_MS);
      }),
    ]).then(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }

  /** Remaining time of the exit flush, or `fallback` outside it. */
  #budget(fallback: number): number {
    return this.#finalBy === undefined
      ? fallback
      : Math.max(0, Math.min(fallback, this.#finalBy - Date.now()));
  }

  /** Pause every send after a `429` (at least 1 s, at most {@link MAX_RETRY_AFTER_MS}). */
  #rateLimited(delayMs: number): void {
    const until =
      Date.now() +
      Math.min(Math.max(delayMs, MIN_RATE_LIMIT_PAUSE_MS), MAX_RETRY_AFTER_MS);
    if (until > this.#holdUntil) this.#holdUntil = until;
    this.debug(
      `rate limited (429): sending pauses for ${Math.round((this.#holdUntil - Date.now()) / 1000)}s`
    );
  }

  #authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.settings.apiKey}` };
  }

  #url(path: string): string {
    return `${this.settings.endpoint.replace(/\/+$/, "")}${path}`;
  }

  /**
   * Whether to ask `GET /v1/config`: never asked yet, or nothing heard for
   * {@link CONFIG_MAX_AGE_MS} (a `202` counts, and a failed fetch waits that
   * long too); never while a `429` or a `402` holds requests on the key back.
   */
  #configDue(): boolean {
    const now = Date.now();
    if (now < this.#holdUntil || now < this.#pausedUntil) return false;
    return (
      this.#configCheckedAt === undefined ||
      this.clock() - this.#configCheckedAt >= CONFIG_MAX_AGE_MS
    );
  }

  /**
   * `GET /v1/config` when it is due (one at a time). On failure the last
   * settings stay; a `401` stops the client and a `429` holds every send
   * back, as one to `POST /v1/events` does.
   */
  #loadConfig(): Promise<void> {
    if (this.#configFetch !== undefined) return this.#configFetch;
    if (!this.#configDue()) return Promise.resolve();
    const first = this.#config === undefined;
    const posted = this.#postedConfigs;
    // Counted before the request, so a failure is not retried for CONFIG_MAX_AGE_MS.
    this.#configCheckedAt = this.clock();
    this.#configFetch = (async () => {
      try {
        // Serialization waits for the answer at most this long, and every
        // 2xx from POST /v1/events carries the settings too, so a slow answer
        // is not worth holding a socket (and a finishing process) longer.
        const reply = await this.#request(
          this.#url("/v1/config"),
          { method: "GET", headers: this.#authHeaders() },
          this.#budget(first ? CONFIG_WAIT_MS : CONFIG_REFRESH_TIMEOUT_MS)
        );
        if (reply.status === 401) {
          this.#unauthorized();
          return;
        }
        if (reply.status === 429) {
          this.#rateLimited(parseRetryAfter(reply.retryAfter) ?? backoff(1));
        }
        const config = readConfig(reply.body);
        if (config === undefined) {
          this.debug(`GET /v1/config answered ${reply.status}`);
          return;
        }
        // A 202 that brought settings while this was in flight wins.
        if (this.#postedConfigs !== posted) return;
        this.#config = config;
        this.#configCheckedAt = this.clock();
      } catch (error) {
        this.debug("GET /v1/config failed", error);
      } finally {
        this.#configFetch = undefined;
      }
    })();
    return this.#configFetch;
  }

  /**
   * The capture settings to serialize with. Before the first batch, and
   * again before any batch once they are {@link CONFIG_MAX_AGE_MS} old, they
   * are fetched first, waiting at most {@link CONFIG_WAIT_MS} for the first
   * answer and {@link CONFIG_REFRESH_TIMEOUT_MS} for a refresh: a dashboard
   * change then applies to the next batch, not to the one after it. Exit and
   * signal flushes never wait.
   */
  async #configForSerialization(): Promise<RemoteConfig> {
    if (
      this.#urgent === 0 &&
      (this.#configFetch !== undefined || this.#configDue())
    ) {
      const waitMs =
        this.#config === undefined ? CONFIG_WAIT_MS : CONFIG_REFRESH_TIMEOUT_MS;
      const fetching = this.#loadConfig();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        fetching,
        new Promise<void>((resolve) => {
          timer = unrefTimeout(resolve, this.#budget(waitMs));
          this.#wakeConfigWait = resolve;
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      this.#wakeConfigWait = undefined;
    }
    return this.#config ?? PRIVATE_CONFIG;
  }

  /**
   * One HTTP exchange with the endpoint, body included, bounded by a timeout
   * so a stalled response cannot block the queue.
   */
  async #request(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<EndpointReply> {
    const controller =
      typeof AbortController === "undefined"
        ? undefined
        : new AbortController();
    const timer =
      controller === undefined
        ? undefined
        : unrefTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        ...(controller !== undefined && { signal: controller.signal }),
      });
      let body: unknown;
      if (response.ok) {
        body = await response.json().catch(() => undefined);
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      return {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #unauthorized(): void {
    this.#state = "unauthorized";
    this.#pending = [];
    this.#ready = [];
    this.#clearTimer();
    this.warnOnce(
      "401",
      "the analytics key was rejected (401): recording stopped until the process restarts with a valid MANUFACT_ANALYTICS_KEY."
    );
  }

  /**
   * Run (or join) the drain loop. The returned promise resolves once a pass
   * that started after this call finished, so it covers every event queued
   * before the call, however long the loop keeps going under steady traffic.
   */
  #drain(force: boolean): Promise<void> {
    if (force) this.#forceNext = true;
    const pass = this.#passes + 1;
    const done = new Promise<void>((resolve) => {
      this.#waiters.push({ pass, resolve });
    });
    this.#running ??= this.#run();
    return done;
  }

  async #run(): Promise<void> {
    try {
      while (this.#waiters.length > 0) {
        const force = this.#forceNext;
        this.#forceNext = false;
        const pass = ++this.#passes;
        try {
          await this.#drainOnce(force, pass);
        } catch (error) {
          this.debug("flush failed", error);
        }
        // Once the client stopped, no later pass would send anything.
        const upTo = this.#state === "active" ? pass : Number.POSITIVE_INFINITY;
        const waiting: DrainWaiter[] = [];
        for (const waiter of this.#waiters) {
          if (waiter.pass <= upTo) waiter.resolve();
          else waiting.push(waiter);
        }
        this.#waiters = waiting;
      }
    } finally {
      this.#running = undefined;
    }
    this.#scheduleRetry();
  }

  #scheduleRetry(): void {
    if (this.#state !== "active") return;
    const now = Date.now();
    let due: number | undefined;
    if (this.#pending.length > 0) {
      due = now + this.settings.flushIntervalMs;
    } else {
      for (const batch of this.#ready) {
        if (due === undefined || batch.notBefore < due) due = batch.notBefore;
      }
    }
    if (due === undefined) return;
    this.#schedule(Math.max(0, Math.max(due, this.#holdUntil) - now));
  }

  async #drainOnce(force: boolean, pass: number): Promise<void> {
    if (this.#state !== "active") return;
    if (Date.now() < this.#pausedUntil) {
      this.#pending = [];
      this.#ready = [];
      return;
    }
    const final = this.#finalBy !== undefined;
    // A 429 pauses all sending, forced or not; pending events stay
    // unserialized so they go out in full batches once it ends.
    if (Date.now() < this.#holdUntil) {
      if (final) this.#discard("sending is paused by a 429");
      return;
    }
    if (this.#pending.length > 0) await this.#serializePending();

    for (;;) {
      if (
        this.#state !== "active" ||
        Date.now() < this.#pausedUntil ||
        Date.now() < this.#holdUntil
      ) {
        break;
      }
      if (final && this.#budget(REQUEST_TIMEOUT_MS) <= 0) break;
      const now = Date.now();
      const index = this.#ready.findIndex(
        (batch) => batch.pass !== pass && (force || batch.notBefore <= now)
      );
      if (index === -1) break;
      const [batch] = this.#ready.splice(index, 1);
      batch!.pass = pass;
      await this.#send(batch!);
    }
    if (final) this.#discard("the process is exiting");
  }

  /** Drop everything still queued (exit flush). */
  #discard(why: string): void {
    const count = this.#queuedCount();
    this.#pending = [];
    this.#ready = [];
    if (count === 0) return;
    this.#dropped += count;
    this.debug(`dropping ${count} undelivered event(s): ${why}`);
  }

  async #serializePending(): Promise<void> {
    // Settings first: events queued while they are fetched are serialized
    // with them too, and a 401 to the fetch leaves nothing behind.
    const config = await this.#configForSerialization();
    if (this.#state !== "active") return;
    const pending = this.#pending;
    this.#pending = [];
    const started = monotonicNow();
    const groups = new Map<
      string,
      { source: EventSource; events: AnalyticsEvent[] }
    >();
    // One deadline for the whole pass: an event still serializing then is
    // dropped instead of holding the pass (and every flush) open.
    const wire: Array<
      { source: EventSource; built: AnalyticsEvent | null } | undefined
    > = new Array<undefined>(pending.length);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<boolean>((resolve) => {
      timer = unrefTimeout(
        () => resolve(true),
        this.#budget(SERIALIZE_TIMEOUT_MS)
      );
    });
    const all = Promise.all(
      pending.map((event, index) =>
        event.toWire(config).then(
          (built) => {
            wire[index] = { source: event.source, built };
          },
          (error: unknown) => {
            this.debug("dropping an event that failed to serialize", error);
            wire[index] = { source: event.source, built: null };
          }
        )
      )
    ).then(() => false);
    if (await Promise.race([all, expired])) {
      const late = wire.filter((entry) => entry === undefined).length;
      this.#dropped += late;
      this.debug(`dropping ${late} event(s) that did not serialize in time`);
    }
    if (timer !== undefined) clearTimeout(timer);
    for (const entry of wire) {
      if (entry === undefined) continue;
      const { source, built } = entry;
      if (built === null) continue;
      const key = `${source.framework}\u0000${source.server?.name ?? ""}\u0000${source.server?.version ?? ""}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = { source, events: [] };
        groups.set(key, group);
      }
      group.events.push(built);
    }
    for (const { source, events } of groups.values()) {
      this.#ready.push(...this.#chunk(source, events));
    }
    this.debug(
      `serialized ${pending.length} event(s) in ${Math.round(monotonicNow() - started)}ms`
    );
  }

  #envelope(source: EventSource): Omit<AnalyticsBatch, "events"> {
    return {
      schema: WIRE_SCHEMA,
      sdk: {
        name: SDK_NAME,
        version: SDK_VERSION,
        language: "typescript",
        framework: source.framework,
        runtime: runtimeName(),
      },
      ...(source.server !== undefined &&
        (source.server.name !== undefined ||
          source.server.version !== undefined) && { server: source.server }),
    };
  }

  #chunk(source: EventSource, events: AnalyticsEvent[]): ReadyBatch[] {
    const limit = Math.min(MAX_EVENTS_PER_BATCH, this.settings.maxBatchSize);
    const head = JSON.stringify(this.#envelope(source));
    const headBytes = utf8Length(head);
    const batches: ReadyBatch[] = [];
    let current: string[] = [];
    let bytes = headBytes;
    const push = () => {
      if (current.length === 0) return;
      batches.push(this.#batch(head, source, current));
      current = [];
      bytes = headBytes;
    };
    for (const event of events) {
      const json = JSON.stringify(event);
      const size = utf8Length(json) + 1;
      if (
        current.length > 0 &&
        (current.length >= limit || bytes + size > MAX_BATCH_BYTES)
      ) {
        push();
      }
      current.push(json);
      bytes += size;
    }
    push();
    return batches;
  }

  #batch(head: string, source: EventSource, json: string[]): ReadyBatch {
    return {
      head,
      events: json,
      source,
      attempts: 0,
      notBefore: 0,
      pass: 0,
    };
  }

  #retryLater(batch: ReadyBatch, delayMs?: number): void {
    batch.attempts += 1;
    const count = batch.events.length;
    if (this.#finalBy !== undefined) {
      this.#dropped += count;
      this.debug(`dropping ${count} event(s): the process is exiting`);
      return;
    }
    if (batch.attempts >= MAX_ATTEMPTS) {
      this.#dropped += count;
      this.debug(`dropping ${count} event(s) after ${batch.attempts} attempts`);
      return;
    }
    batch.notBefore = Date.now() + (delayMs ?? backoff(batch.attempts));
    this.#ready.push(batch);
  }

  /**
   * Put a batch back, attempts unchanged, to go out once a `429`'s pause
   * ends: being rate limited is not a failed attempt.
   */
  #holdBack(batch: ReadyBatch): void {
    if (this.#finalBy !== undefined) {
      const count = batch.events.length;
      this.#dropped += count;
      this.debug(`dropping ${count} event(s): the process is exiting`);
      return;
    }
    this.#ready.unshift(batch);
  }

  /**
   * Handle a 2xx `rejected` list: events whose entry is `retryable` (the
   * edge could not enqueue them) are retried with backoff; the rest of the
   * batch was accepted, or rejected for good, and is never sent again.
   */
  #settleRejected(batch: ReadyBatch, body: unknown): void {
    const rejected = isRecord(body) ? body["rejected"] : undefined;
    const count = batch.events.length;
    if (!Array.isArray(rejected) || rejected.length === 0) {
      this.debug(`delivered ${count} event(s)`);
      return;
    }
    const retry = new Set<number>();
    const lost = new Set<number>();
    for (const entry of rejected) {
      const index = isRecord(entry) ? entry["index"] : undefined;
      if (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= count
      ) {
        continue;
      }
      if ((entry as Record<string, unknown>)["retryable"] === true) {
        retry.add(index);
      } else {
        lost.add(index);
      }
    }
    for (const index of lost) retry.delete(index);
    this.#dropped += lost.size;
    this.debug(
      `delivered ${count - retry.size - lost.size} event(s); ${lost.size} rejected, ${retry.size} to retry`,
      rejected
    );
    if (retry.size === 0) return;
    this.#retryLater({
      head: batch.head,
      events: [...retry]
        .sort((a, b) => a - b)
        .map((index) => batch.events[index]!),
      source: batch.source,
      attempts: batch.attempts,
      notBefore: 0,
      pass: batch.pass,
    });
  }

  async #send(batch: ReadyBatch): Promise<void> {
    let reply: EndpointReply;
    try {
      reply = await this.#request(
        this.#url("/v1/events"),
        {
          method: "POST",
          headers: {
            ...this.#authHeaders(),
            "content-type": "application/json",
          },
          body: batchBody(batch),
        },
        this.#budget(REQUEST_TIMEOUT_MS)
      );
    } catch (error) {
      this.debug("POST /v1/events failed; will retry", error);
      this.#retryLater(batch);
      return;
    }

    const status = reply.status;
    if (status >= 200 && status < 300) {
      const config = readConfig(reply.body);
      if (config !== undefined) {
        this.#config = config;
        this.#configCheckedAt = this.clock();
        this.#postedConfigs += 1;
      }
      this.#settleRejected(batch, reply.body);
      return;
    }

    if (status === 401) {
      this.#unauthorized();
      return;
    }
    if (status === 402) {
      this.#pausedUntil = Date.now() + PAYMENT_PAUSE_MS;
      this.#pending = [];
      this.#ready = [];
      this.warnOnce(
        "402",
        "Manufact credits are exhausted (402): events are dropped and sending pauses for 10 minutes."
      );
      return;
    }
    const count = batch.events.length;
    if (status === 413 && count > 1) {
      const half = Math.ceil(count / 2);
      for (const part of [
        batch.events.slice(half),
        batch.events.slice(0, half),
      ]) {
        this.#ready.unshift(this.#batch(batch.head, batch.source, part));
      }
      return;
    }
    if (status === 429) {
      // Retry-After applies to the key, so every send waits for it, not this
      // batch only, and the wait uses up none of the batch's attempts however
      // long the rate limit lasts. A 429 without it is a failed attempt.
      const retryAfter = parseRetryAfter(reply.retryAfter);
      if (retryAfter === undefined) {
        const delay = backoff(batch.attempts + 1);
        this.#rateLimited(delay);
        this.#retryLater(batch, delay);
      } else {
        this.#rateLimited(retryAfter);
        this.#holdBack(batch);
      }
      return;
    }
    if (status === 408 || status >= 500) {
      // 503: nothing of the batch was enqueued, so all of it is resent.
      const retryAfter = parseRetryAfter(reply.retryAfter);
      this.debug(`POST /v1/events answered ${status}; will retry`);
      this.#retryLater(batch, retryAfter);
      return;
    }
    // 400, 413 for a single event, 404 and other client errors are not retryable.
    this.#dropped += count;
    if (status === 404 || status === 405) {
      this.warnOnce(
        "404",
        `the ingest endpoint ${this.settings.endpoint} answered ${status}; check MANUFACT_ANALYTICS_URL.`
      );
    }
    this.debug(`POST /v1/events answered ${status}; dropped ${count} event(s)`);
  }
}
