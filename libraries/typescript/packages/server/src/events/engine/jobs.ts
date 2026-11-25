/**
 * Job runtime context and job record I/O (PLAN.md §8.10.1). Every job lives
 * at `ev:{ns}:job:{jobId}` (7 d safety TTL) and, while it is due work, in
 * `idx ev:{ns}:due` scored by its next attempt time. Unknown job kinds
 * (written by a newer build) are never decoded as claimable (layout rule 3).
 *
 * The engine reaches storage only through {@link EngineContext}, so the
 * layout-1 key codec (WP-12), the sealing codec and the sender are injected.
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import type { EventsLogRecord } from "../log-records.js";
import type { WebhookSender } from "../types.js";
import type { Clock } from "../internal/clock.js";
import type { EventsRegistry } from "../internal/registry.js";
import type { EventsJob } from "../internal/records.js";
import { EVENTS_DEFAULTS } from "../config.js";

/** Key builders for the families the job runtime touches (layout 1). */
export interface EngineKeys {
  job(jobId: string): string;
  due(): string;
  dead(jobId: string): string;
  deadIdx(): string;
  inflight(subscriptionId: string): string;
  attempts(subscriptionId: string): string;
  sub(subscriptionId: string): string;
  status(subscriptionId: string): string;
  tomb(subscriptionId: string): string;
  cb(host: string): string;
  log(name: string): string;
  fanout(name: string): string;
  fanoutDue(): string;
  lockFanout(name: string): string;
  byName(name: string): string;
  byNamePartition(name: string, partition: string): string;
  byNamePartitioned(name: string): string;
  verified(principal: string, url: string): string;
  verifyFail(principal: string, url: string): string;
  rlVerifyPrincipal(principal: string, host: string, minute: number): string;
  rlVerifyHost(host: string, minute: number): string;
  inflightVerify(host: string): string;
}

/** Record (de)serialization; WP-12 seals secrets inside `encode`/`decode`. */
export interface EngineCodec {
  encode(value: unknown): Promise<string> | string;
  decode<T>(raw: string): Promise<T> | T;
}

/** The plain JSON codec (tests and unsealed stores). */
export const jsonCodec: EngineCodec = {
  encode: (v) => JSON.stringify(v),
  decode: <T>(raw: string) => JSON.parse(raw) as T,
};

/**
 * Decode one raw event-log value, unsealing it when the log is sealed.
 *
 * @returns The value, or undefined when it does not open or parse.
 */
export async function decodeLogValue<T>(
  ctx: Pick<EngineContext, "codec" | "openLog">,
  key: string,
  raw: string
): Promise<T | undefined> {
  if (ctx.openLog === undefined) return ctx.codec.decode<T>(raw);
  const text = await ctx.openLog(key, raw);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Resolved runtime knobs of the job runtime (Appendix C defaults). */
export interface JobRuntimeConfig {
  retryDelaysMs: readonly number[];
  retryJitter: number;
  retryWindowMs: number;
  retryMaxAgeMs: number;
  deadLetterTtlMs: number;
  deliveryTimeoutMs: number;
  connectTimeoutMs: number;
  perHostConcurrency: number;
  hostConcurrency: Readonly<Record<string, number>>;
  perSubscriptionConcurrency: number;
  deliveriesPerSubscriptionPerMinute: number;
  maxPendingPerSubscription: number;
  replayPacingUnsettled: number;
  suspensionFailureRate: number;
  suspensionWindowMs: number;
  suspensionMinAttempts: number;
  dropNoExpiryAfterMs: number;
  breakerFailures: number;
  breakerOpenForMs: readonly number[];
  maxEnvelopeBytes: number;
  attemptLogMax: number;
  rotationGraceMs: number;
  /** Claim lease length. */
  leaseMs: number;
  /** Job record safety TTL. */
  jobTtlMs: number;
}

/** Appendix C defaults for {@link JobRuntimeConfig}. */
export function defaultJobRuntimeConfig(
  overrides: Partial<JobRuntimeConfig> = {}
): JobRuntimeConfig {
  const d = EVENTS_DEFAULTS;
  return {
    retryDelaysMs: d.retryDelaysMs,
    retryJitter: d.retryJitter,
    retryWindowMs: d.retryWindowMs,
    retryMaxAgeMs: d.retryMaxAgeMs,
    deadLetterTtlMs: d.deadLetterTtlMs,
    deliveryTimeoutMs: d.deliveryTimeoutMs,
    connectTimeoutMs: d.connectTimeoutMs,
    perHostConcurrency: d.perHostConcurrency,
    hostConcurrency: {},
    perSubscriptionConcurrency: d.perSubscriptionConcurrency,
    deliveriesPerSubscriptionPerMinute: d.deliveriesPerSubscriptionPerMinute,
    maxPendingPerSubscription: d.maxPendingPerSubscription,
    replayPacingUnsettled: d.replayPacingUnsettled,
    suspensionFailureRate: d.suspensionFailureRate,
    suspensionWindowMs: d.suspensionWindowMs,
    suspensionMinAttempts: d.suspensionMinAttempts,
    dropNoExpiryAfterMs: d.dropNoExpiryAfterMs,
    breakerFailures: d.breakerFailures,
    breakerOpenForMs: d.breakerOpenForMs,
    maxEnvelopeBytes: d.maxEnvelopeBytes,
    attemptLogMax: d.attemptLogMax,
    rotationGraceMs: d.rotationGraceMs,
    leaseMs: 30_000,
    jobTtlMs: 7 * 24 * 3_600_000,
    ...overrides,
  };
}

/** Everything the job runtime, dispatcher and verifier need. */
export interface EngineContext {
  storage: McpUseStorage;
  keys: EngineKeys;
  codec: EngineCodec;
  clock: Clock;
  registry: EventsRegistry;
  send: WebhookSender["send"];
  log: (record: EventsLogRecord) => void;
  /** This instance's lease owner id. */
  owner: string;
  config: JobRuntimeConfig;
  /** Encodes a body cursor `c(name, epoch, seq)`; WP-13's codec. The name binds the MAC, so it must be the event name. */
  cursor?: (
    name: string,
    epoch: string,
    seq: number
  ) => Promise<string> | string;
  /** Opens a sealed event-log value bound to its log key; absent for plaintext logs. */
  openLog?: (key: string, raw: string) => Promise<string | undefined>;
  /** Per-instance concurrency counters (host and subscription). */
  inflight?: InstanceInflight;
}

/** Per-instance in-flight counters (step 10 of §8.10.2). */
export class InstanceInflight {
  readonly #counts = new Map<string, number>();

  /** Try to take one slot of `key` under `limit`. */
  take(key: string, limit: number): boolean {
    const n = this.#counts.get(key) ?? 0;
    if (n >= limit) return false;
    this.#counts.set(key, n + 1);
    return true;
  }

  /** Release one slot of `key`. */
  release(key: string): void {
    const n = (this.#counts.get(key) ?? 1) - 1;
    if (n <= 0) this.#counts.delete(key);
    else this.#counts.set(key, n);
  }
}

/** Job kinds this build processes. */
export const KNOWN_JOB_KINDS: readonly EventsJob["kind"][] = [
  "deliver",
  "control",
  "hook",
  "replay",
];

/** Whether a decoded job has a kind this build knows. */
export function isKnownJob(value: unknown): value is EventsJob {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { v?: unknown; kind?: unknown; id?: unknown };
  return (
    v.v === 1 &&
    typeof v.id === "string" &&
    (KNOWN_JOB_KINDS as readonly unknown[]).includes(v.kind)
  );
}

/** A job read with its storage version. */
export interface StoredJob<J extends EventsJob = EventsJob> {
  job: J;
  version: string;
}

/**
 * Read a job. Returns `"unknown"` for a job of a kind this build does not
 * know (left untouched), or undefined when missing.
 */
export async function readJob(
  ctx: EngineContext,
  jobId: string
): Promise<StoredJob | "unknown" | undefined> {
  const got = await ctx.storage.read(ctx.keys.job(jobId));
  if (!got) return undefined;
  const value = await ctx.codec.decode<unknown>(got.value);
  if (!isKnownJob(value)) return "unknown";
  return { job: value, version: got.version };
}

/**
 * Write a job. `ifVersion: null` is put-if-absent; returns the new version or
 * false when the condition failed.
 */
export async function writeJob(
  ctx: EngineContext,
  job: EventsJob,
  ifVersion?: string | null
): Promise<string | false> {
  return ctx.storage.write(ctx.keys.job(job.id), await ctx.codec.encode(job), {
    ...(ifVersion !== undefined ? { ifVersion } : {}),
    ttlMs: ctx.config.jobTtlMs,
  });
}

/**
 * Write a new job put-if-absent and due-index it at `nextAt`. An existing job
 * keeps its record and its due score (crash repair adds only a missing member).
 *
 * @returns Whether the job was created.
 */
export async function enqueueJob(
  ctx: EngineContext,
  job: EventsJob,
  nextAt: number
): Promise<boolean> {
  const created = (await writeJob(ctx, job, null)) !== false;
  await ctx.storage.indexAdd(ctx.keys.due(), job.id, nextAt, {
    onlyIfAbsent: true,
  });
  return created;
}

/**
 * Settle a job in the load-bearing order: `inflight` → `due` → record. A crash
 * leaves at worst a re-sent delivery, never a pinned watermark.
 */
export async function settleJob(
  ctx: EngineContext,
  jobId: string,
  subscriptionId: string | null
): Promise<void> {
  if (subscriptionId !== null)
    await ctx.storage.indexRemove(ctx.keys.inflight(subscriptionId), jobId);
  await ctx.storage.indexRemove(ctx.keys.due(), jobId);
  await ctx.storage.remove(ctx.keys.job(jobId));
}

/** Job id of a deliver job: `d.<h(subId ‖ 0x00 ‖ eventId)>`. */
export async function deliverJobId(
  subscriptionId: string,
  eventId: string
): Promise<string> {
  return `d.${await digest(`${subscriptionId}\u0000${eventId}`)}`;
}

/** Job id of a hook job: `h.<h(id ‖ reason ‖ expiresAt)>`. */
export async function hookJobId(
  subscriptionId: string,
  reason: string,
  expiresAt: number | null
): Promise<string> {
  return `h.${await digest(`${subscriptionId}\u0000${reason}\u0000${expiresAt ?? "none"}`)}`;
}

/** 22-character base64url SHA-256 digest prefix. */
export async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text)
    )
  );
  let bin = "";
  for (const b of bytes.subarray(0, 16)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The callback host (`hostname[:port]`) of a URL, lower-cased. */
export function callbackHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "invalid";
  }
}
