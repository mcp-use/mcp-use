/**
 * The `events/stream` responder (D52, PLAN.md §6.11): validation, caps, then
 * an SSE response that sends `active` first, catches up from storage, drains
 * entries the tail buffered meanwhile and goes live with no gap or duplicate.
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";
import type { JsonRpcErrorObject } from "@mcp-use/events-core";
import { EVENTS_DEFAULTS } from "../config.js";
import type { Clock } from "../internal/clock.js";
import type { LogValue } from "../internal/records.js";
import type { SubscriptionInfo } from "../types.js";
import type { LeaseToucher } from "../engine/leases.js";
import {
  nextPollMs,
  occurrence,
  targets,
  validateDirectRequest,
  type CursorCodec,
  type DirectValidationDeps,
} from "../engine/poll.js";
import { ANONYMOUS_PRINCIPAL } from "../engine/quotas.js";
import {
  STREAM_HEADERS,
  activeFrame,
  errorFrame,
  eventFrame,
  heartbeatFrame,
  resultFrame,
  terminatedFrame,
  type RpcId,
} from "./frames.js";
import type { LogTail, TailEntry } from "./logtail.js";

/**
 * Heartbeat grant: `clamp(requested ?? 30 s, 5 s, max)`, an integer.
 *
 * @param requested - `params.heartbeatMs`.
 * @param maxMs - `MCP_USE_EVENTS_HEARTBEAT_MAX_MS` (default 55 s).
 */
export function grantHeartbeat(
  requested: unknown,
  maxMs: number = EVENTS_DEFAULTS.heartbeatMaxMs
): number {
  const r =
    typeof requested === "number" && Number.isFinite(requested)
      ? requested
      : EVENTS_DEFAULTS.heartbeatDefaultMs;
  return Math.round(
    Math.min(Math.max(r, EVENTS_DEFAULTS.heartbeatMinMs), Math.max(maxMs, EVENTS_DEFAULTS.heartbeatMinMs))
  );
}

/**
 * Stream lifetime: `min(maxDuration, tokenExpiresAt − now − 5 s)`; `0` means
 * unlimited; `null` when unlimited.
 */
export function streamLifetimeMs(
  maxDurationMs: number,
  now: number,
  tokenExpiresAt?: number
): number | null {
  const caps: number[] = [];
  if (maxDurationMs > 0) caps.push(maxDurationMs);
  if (tokenExpiresAt !== undefined) caps.push(Math.max(0, tokenExpiresAt - now - 5000));
  return caps.length === 0 ? null : Math.min(...caps);
}

/** Per-principal and per-instance stream caps; also closes every stream at shutdown. */
export class StreamRegistry {
  readonly #byKey = new Map<string, number>();
  readonly #closers = new Set<() => void>();
  #total = 0;

  /**
   * @param perPrincipal - 20 (for `anonymous`, per client address).
   * @param perInstance - 1,000.
   */
  constructor(
    readonly perPrincipal: number = EVENTS_DEFAULTS.streamsPerPrincipal,
    readonly perInstance: number = EVENTS_DEFAULTS.maxStreams
  ) {}

  /** Open streams on this instance. */
  get size(): number {
    return this.#total;
  }

  /**
   * Reserves one slot.
   *
   * @throws EventsError ResourceExhausted `{limit:"streams", max}`.
   */
  acquire(key: string): () => void {
    if (this.#total >= this.perInstance)
      throw new EventsError("resourceExhausted", "", { limit: "streams", max: this.perInstance });
    const n = this.#byKey.get(key) ?? 0;
    if (n >= this.perPrincipal)
      throw new EventsError("resourceExhausted", "", { limit: "streams", max: this.perPrincipal });
    this.#byKey.set(key, n + 1);
    this.#total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#total--;
      const m = (this.#byKey.get(key) ?? 1) - 1;
      if (m <= 0) this.#byKey.delete(key);
      else this.#byKey.set(key, m);
    };
  }

  /** Registers a graceful closer for shutdown and hot reload. */
  track(close: () => void): () => void {
    this.#closers.add(close);
    return () => this.#closers.delete(close);
  }

  /** Ends every open stream gracefully (heartbeat, result frame, close). */
  closeAll(): void {
    for (const c of [...this.#closers]) c();
  }
}

/** Collaborators of {@link handleStream}. */
export interface StreamDeps extends DirectValidationDeps {
  codec: CursorCodec;
  tail: LogTail;
  clock: Pick<Clock, "now" | "setTimeout">;
  streams: StreamRegistry;
  /** `MCP_USE_EVENTS_HEARTBEAT_MAX_MS`. */
  heartbeatMaxMs?: number;
  /** `push.maxDuration` for this host; `0` = unlimited. */
  maxDurationMs: number;
  /** OAuth token expiry, epoch ms. */
  tokenExpiresAt?: number;
  clientAddress?: string;
  pollIntervalMs: number;
  leases?: LeaseToucher;
  onSubscribe(ev: import("../internal/registry.js").RegisteredEvent, info: SubscriptionInfo<Record<string, unknown>>): Promise<void>;
  /** Serializes an EventsError in the caller's numbering. */
  toJsonRpc(err: EventsError): JsonRpcErrorObject;
  /** Backlog limit in bytes (1 MiB). */
  maxBacklogBytes?: number;
}

const encoder = new TextEncoder();

/**
 * Validates an `events/stream` request and opens the stream. Validation
 * errors throw before any response, so the caller answers with a JSON-RPC
 * error in a JSON response.
 *
 * @param id - The request's JSON-RPC id (the frames' subscription id).
 * @param signal - Aborted when the client disconnects.
 */
export async function handleStream(
  id: RpcId,
  params: Record<string, unknown>,
  deps: StreamDeps,
  signal?: AbortSignal
): Promise<Response> {
  const req = await validateDirectRequest(params, deps, "push");
  const { ev, name, args, principal, directId } = req;
  const capKey =
    principal === ANONYMOUS_PRINCIPAL
      ? `addr:${deps.clientAddress ?? "unknown"}`
      : `p:${principal}`;
  const release = deps.streams.acquire(capKey);
  const replayable = ev.replay !== false;
  const heartbeatMs = grantHeartbeat(params.heartbeatMs, deps.heartbeatMaxMs);
  const interval = nextPollMs(ev, deps.pollIntervalMs);
  try {
    if (deps.leases)
      await deps.leases.touch({
        ev,
        id: directId,
        principal,
        args,
        mode: "push",
        nextPollMs: interval,
        now: deps.clock.now(),
        onSubscribe: (info) => deps.onSubscribe(ev, info),
      });
  } catch (err) {
    release();
    throw err;
  }

  const maxBacklog = deps.maxBacklogBytes ?? EVENTS_DEFAULTS.maxBacklogBytes;
  const match = { principal, subscriptionId: directId, dialect: "sep-3415", mode: "push" as const };
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let live = false;
  const buffered: TailEntry[] = [];
  let epoch: string | null = null;
  let pos = 0;
  let floor: number | null = null;
  let lastErrorFrameAt = -Infinity;
  const timers: Array<() => void> = [];
  let cancelHeartbeat: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();
  let unregister: () => void = () => {};
  let untrack: () => void = () => {};

  const cursor = async (): Promise<string | null> =>
    replayable ? deps.codec.encode(name, epoch, pos) : null;

  const cleanup = (): void => {
    closed = true;
    cancelHeartbeat?.();
    for (const t of timers) t();
    unregister();
    untrack();
    release();
  };
  const write = (frame: string): void => {
    if (closed) return;
    const bytes = encoder.encode(frame);
    controller.enqueue(bytes);
    armHeartbeat();
    if (controller.desiredSize !== null && controller.desiredSize < 0) {
      // Backlog above the limit: end gracefully.
      void enqueue(() => finish(null));
    }
  };
  const finish = async (terminate: EventsError | null): Promise<void> => {
    if (closed) return;
    if (terminate) write(terminatedFrame(id, deps.toJsonRpc(terminate)));
    else write(heartbeatFrame(id, await cursor()));
    write(resultFrame(id));
    cleanup();
    controller.close();
  };
  const enqueue = (fn: () => Promise<void> | void): Promise<void> => {
    chain = chain.then(async () => {
      if (!closed) await fn();
    }).catch(() => {});
    return chain;
  };
  function armHeartbeat(): void {
    cancelHeartbeat?.();
    if (closed) return;
    cancelHeartbeat = deps.clock.setTimeout(() => {
      void enqueue(async () => write(heartbeatFrame(id, await cursor())));
    }, heartbeatMs);
  }
  const offer = async (entries: readonly TailEntry[]): Promise<void> => {
    for (const e of entries) {
      if (closed) return;
      if (e.seq <= pos) continue;
      const v: LogValue = e.value;
      pos = e.seq;
      if (v.k === "t") {
        if (targets(v.to, principal, directId)) {
          await finish(new EventsError(v.error.kind, v.error.message, v.error.data));
          return;
        }
        continue;
      }
      if (floor !== null && v.at < floor) continue;
      if (v.to?.subscriptionId !== undefined) continue;
      if (!targets(v.to, principal, directId)) continue;
      if (await ev.match(args, v.data, match))
        write(eventFrame(id, occurrence(name, v), await cursor()));
    }
  };

  const body = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c;
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: maxBacklog, size: (chunk) => chunk.byteLength }
  );

  const reg = await deps.tail.register(name, {
    onEntries: (ep, entries) => {
      if (!live) {
        buffered.push(...entries);
        return;
      }
      void enqueue(async () => {
        epoch = ep;
        await offer(entries);
      });
    },
    onGap: (ep, first) => {
      void enqueue(async () => {
        epoch = ep;
        buffered.length = 0;
        pos = first - 1;
        if (replayable)
          write(activeFrame(id, { cursor: await cursor(), truncated: true, heartbeatMs }));
      });
    },
    onError: () => {
      void enqueue(() => {
        const now = deps.clock.now();
        if (now - lastErrorFrameAt < 60_000) return;
        lastErrorFrameAt = now;
        write(
          errorFrame(id, {
            code: -32603,
            message: "UpstreamError",
            data: { reason: "storage_unavailable" },
          })
        );
      });
    },
  });
  unregister = reg.unregister;
  epoch = reg.epoch;
  pos = reg.head;
  let truncated = false;
  if (replayable && req.cursor !== null) {
    const r = await deps.codec.resolve(name, req.cursor, {
      ...(req.maxAgeMs !== undefined ? { maxAgeMs: req.maxAgeMs } : {}),
      now: deps.clock.now(),
    });
    if (r.epoch === reg.epoch && r.seq <= reg.head) {
      pos = r.seq;
      floor = r.floor;
    }
    truncated = r.reset;
  }

  void enqueue(async () => {
    write(activeFrame(id, { cursor: await cursor(), truncated, heartbeatMs }));
    // Catch up from storage to the head seen at registration.
    while (!closed && pos < reg.head) {
      const page = await deps.backend.readLog(name, pos, { limit: 200 });
      if (page.epoch !== epoch || page.first > pos + 1) {
        epoch = page.epoch;
        pos = page.first - 1;
        if (replayable)
          write(activeFrame(id, { cursor: await cursor(), truncated: true, heartbeatMs }));
      }
      if (page.entries.length === 0) break;
      await offer(page.entries.filter((e) => e.seq <= reg.head));
    }
    // Drain what the tail buffered, then go live.
    const drained = buffered.splice(0);
    await offer(drained);
    live = true;
  });

  untrack = deps.streams.track(() => void enqueue(() => finish(null)));
  const lifetime = streamLifetimeMs(deps.maxDurationMs, deps.clock.now(), deps.tokenExpiresAt);
  if (lifetime !== null)
    timers.push(deps.clock.setTimeout(() => void enqueue(() => finish(null)), lifetime));
  const reauth = (): void => {
    timers.push(
      deps.clock.setTimeout(() => {
        void enqueue(async () => {
          if (!(await deps.authorize(ev, args)))
            await finish(new EventsError("forbidden", "", { reason: "not_authorized" }));
          else reauth();
        });
      }, EVENTS_DEFAULTS.reauthorizeMs)
    );
  };
  reauth();
  signal?.addEventListener("abort", cleanup, { once: true });

  return new Response(body, { status: 200, headers: { ...STREAM_HEADERS } });
}
