/**
 * The `client.events` manager (PLAN.md §9.5): mode choice, runners,
 * persisted `ClientSubscriptionRecord` v1, dedupe, resume, receiver wiring.
 *
 * @packageDocumentation
 */

import type {
  DeliveryMode,
  EventDescriptor,
  EventEnvelope,
} from "@mcp-use/events-core";
import type { EventsConnection } from "./connection.js";
import { LruSet, pushRecentEventId } from "./dedupe.js";
import { createWebhookHandler } from "./receiver.js";
import {
  runPoll,
  type RunnerContext,
  type RunnerExit,
} from "./runners/poll.js";
import { runPush } from "./runners/push.js";
import { cancelWebhook, runWebhook } from "./runners/webhook.js";
import {
  argsKeyOf,
  memoryEventsStore,
  parseRecord,
  recordKey,
  RECORD_PREFIX,
} from "./store.js";
import {
  EventsClientError,
  type ClientSubscribeOptions,
  type ClientSubscriptionRecord,
  type EventsManagerOptions,
  type EventsStore,
} from "./types.js";

/** Cursor writes are throttled to one per second per subscription. */
export const CURSOR_PERSIST_INTERVAL_MS = 1_000;

/** Context passed to `onEvent`. */
export interface EventDeliveryInfo {
  /** MCPClient server key. */
  server: string;
  /** The subscription the event belongs to. */
  subscription: EventSubscription;
}

/** Options of {@link EventsManager} beyond the public {@link EventsManagerOptions}. */
export interface EventsManagerInit extends EventsManagerOptions {
  /** Resolve the current Events connection of a server (opens a session if needed). */
  connection(server: string): Promise<EventsConnection>;
  /** Every delivered event (data is untrusted). */
  onEvent?: (
    event: EventEnvelope,
    info: EventDeliveryInfo
  ) => void | Promise<void>;
  /** Typed client errors. */
  onEventsError?: (err: EventsClientError) => void;
  /** The webhook receiver URL when `receiver.listen` started one. */
  receiverUrl?: () => string | undefined;
  /** Time to wait for push `active`; default 30 s. */
  activeTimeoutMs?: number;
}

/** One subscription: async-iterable events plus control. */
export class EventSubscription implements AsyncIterable<EventEnvelope> {
  /** The persisted record. */
  readonly record: ClientSubscriptionRecord;
  /** Store key. */
  readonly key: string;
  readonly #queue: EventEnvelope[] = [];
  readonly #waiters: Array<(r: IteratorResult<EventEnvelope>) => void> = [];
  #ended = false;
  #controller = new AbortController();
  #onClose: (cancel: boolean) => Promise<void>;

  /** @internal */
  constructor(
    record: ClientSubscriptionRecord,
    key: string,
    onClose: (cancel: boolean) => Promise<void>
  ) {
    this.record = record;
    this.key = key;
    this.#onClose = onClose;
  }

  /** Current cursor. */
  get cursor(): string | null {
    return this.record.cursor;
  }
  /** Current mode. */
  get mode(): DeliveryMode {
    return this.record.mode;
  }
  /** Webhook subscription id, or the record key for poll and push. */
  get id(): string {
    return this.record.webhook?.subscriptionId || this.key;
  }
  /** @internal */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }
  /** @internal Replace the abort controller for a runner restart. */
  restartSignal(): AbortSignal {
    this.#controller = new AbortController();
    return this.#controller.signal;
  }
  /** @internal */
  push(e: EventEnvelope): void {
    if (this.#ended) return;
    const w = this.#waiters.shift();
    if (w) w({ value: e, done: false });
    else this.#queue.push(e);
  }
  /** @internal */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#controller.abort();
    for (const w of this.#waiters.splice(0))
      w({ value: undefined, done: true });
  }

  /** Stop locally; the persisted record stays and is resumed later. */
  async close(): Promise<void> {
    await this.#onClose(false);
  }
  /** Unsubscribe (webhook), forget the record and the secret. */
  async cancel(): Promise<void> {
    await this.#onClose(true);
  }

  [Symbol.asyncIterator](): AsyncIterator<EventEnvelope> {
    return {
      next: () => {
        const e = this.#queue.shift();
        if (e) return Promise.resolve({ value: e, done: false });
        if (this.#ended)
          return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.#waiters.push(r));
      },
      return: async () => {
        await this.close();
        return { value: undefined, done: true };
      },
    };
  }
}

interface Active {
  sub: EventSubscription;
  options: ClientSubscribeOptions;
  lastPersist: number;
  persistTimer?: ReturnType<typeof setTimeout>;
}

/**
 * The Events manager behind `client.events`.
 */
export class EventsManager {
  readonly #init: EventsManagerInit;
  readonly #store: EventsStore;
  readonly #lru = new LruSet();
  readonly #active = new Map<string, Active>();
  readonly #catalog = new Map<string, EventDescriptor[]>();
  /** Per-server push fallback for this session. */
  readonly #pushFallback = new Set<string>();

  /**
   * @param init - Options and the connection resolver.
   */
  constructor(init: EventsManagerInit) {
    this.#init = init;
    this.#store = init.store ?? memoryEventsStore();
  }

  /** The store in use. */
  get store(): EventsStore {
    return this.#store;
  }

  #prefer(): readonly DeliveryMode[] {
    if (this.#init.prefer) return this.#init.prefer;
    return this.#receiverUrl() ? ["webhook", "push", "poll"] : ["push", "poll"];
  }

  #receiverUrl(): string | undefined {
    const fromListen = this.#init.receiverUrl?.();
    if (fromListen) return fromListen;
    const r = this.#init.receiver;
    return r && "url" in r ? r.url : undefined;
  }

  /**
   * Events listed by a server (cached; refreshed on reconnect and refresh).
   *
   * @param server - Server key.
   * @returns The cached descriptors, or `[]` before the first listing.
   */
  list(server: string): readonly EventDescriptor[] {
    return this.#catalog.get(server) ?? [];
  }

  /**
   * Re-list a server's events.
   *
   * @param server - Server key.
   * @returns The descriptors.
   */
  async refreshList(server: string): Promise<readonly EventDescriptor[]> {
    const conn = await this.#init.connection(server);
    const { events } = await conn.listAllEvents();
    this.#catalog.set(server, events);
    return events;
  }

  /**
   * Active subscription records.
   *
   * @returns The records of running subscriptions.
   */
  subscriptions(): ReadonlyArray<ClientSubscriptionRecord> {
    return [...this.#active.values()].map((a) => a.sub.record);
  }

  /**
   * Choose a delivery mode.
   *
   * @param server - Server key.
   * @param descriptor - The event descriptor.
   * @param forced - A forced mode.
   * @returns The mode.
   * @throws {@link EventsClientError} `mode_unavailable` or `receiver_required`.
   */
  chooseMode(
    server: string,
    descriptor: EventDescriptor,
    forced?: DeliveryMode
  ): DeliveryMode {
    const listed = descriptor.delivery;
    if (forced) {
      if (!listed.includes(forced)) {
        throw new EventsClientError(
          "mode_unavailable",
          `${descriptor.name} does not offer ${forced}`,
          { server, name: descriptor.name, data: { listed, forced } }
        );
      }
      if (forced === "webhook" && !this.#receiverUrl()) {
        throw new EventsClientError(
          "receiver_required",
          "Webhook mode needs a receiver",
          { server, name: descriptor.name }
        );
      }
      return forced;
    }
    let prefer = this.#prefer().filter((m) => listed.includes(m));
    if (this.#pushFallback.has(server)) {
      prefer = [
        ...prefer.filter((m) => m !== "push"),
        ...prefer.filter((m) => m === "push"),
      ];
    }
    if (!this.#receiverUrl()) prefer = prefer.filter((m) => m !== "webhook");
    const mode = prefer[0];
    if (!mode) {
      if (listed.length === 1 && listed[0] === "webhook") {
        throw new EventsClientError(
          "receiver_required",
          `${descriptor.name} is delivered by webhook only; configure events.receiver`,
          { server, name: descriptor.name, data: { listed } }
        );
      }
      throw new EventsClientError(
        "mode_unavailable",
        `No preferred mode is offered for ${descriptor.name}`,
        {
          server,
          name: descriptor.name,
          data: { listed, prefer: this.#prefer() },
        }
      );
    }
    return mode;
  }

  async #descriptor(server: string, name: string): Promise<EventDescriptor> {
    let d = this.list(server).find((e) => e.name === name);
    if (!d) d = (await this.refreshList(server)).find((e) => e.name === name);
    if (!d) {
      throw new EventsClientError(
        "terminated",
        `Server ${server} does not list event ${name}`,
        { server, name, data: { kind: "notFound" } }
      );
    }
    return d;
  }

  /**
   * Subscribe to an event.
   *
   * @param server - Server key.
   * @param name - Event name.
   * @param args - Subscription arguments.
   * @param options - Mode, TTL, cursor, replay floor and callbacks.
   * @returns The subscription.
   */
  async subscribe<T = unknown>(
    server: string,
    name: string,
    args: Record<string, unknown> = {},
    options: ClientSubscribeOptions = {}
  ): Promise<EventSubscription & AsyncIterable<EventEnvelope<T>>> {
    const conn = await this.#init.connection(server);
    if (conn.supportsEvents() === false && !this.#init.probe) {
      throw new EventsClientError(
        "not_supported",
        `Server ${server} does not advertise Events`,
        { server, name }
      );
    }
    const descriptor = await this.#descriptor(server, name);
    const argsKey = argsKeyOf(args);
    const key = await recordKey(server, name, argsKey);
    const existing = this.#active.get(key);
    if (existing)
      return existing.sub as EventSubscription &
        AsyncIterable<EventEnvelope<T>>;

    const stored = parseRecord(await this.#store.get(key));
    let mode: DeliveryMode;
    if (
      stored &&
      !options.mode &&
      descriptor.delivery.includes(stored.mode) &&
      (stored.mode !== "webhook" || this.#receiverUrl())
    ) {
      mode = stored.mode;
    } else {
      mode = this.chooseMode(server, descriptor, options.mode);
    }
    const record: ClientSubscriptionRecord = {
      ...(stored ?? {}),
      v: 1,
      server,
      name,
      args,
      argsKey,
      mode,
      cursor:
        options.cursor !== undefined
          ? options.cursor
          : (stored?.cursor ?? null),
      dialect: stored?.dialect ?? this.#init.dialect ?? "auto",
      createdAt: stored?.createdAt ?? new Date().toISOString(),
      recentEventIds: stored?.recentEventIds ?? [],
      ...(options.maxAgeMs !== undefined ? { maxAgeMs: options.maxAgeMs } : {}),
    };
    if (mode !== "webhook") delete record.webhook;
    await this.#store.set(key, JSON.stringify(record));
    const sub = new EventSubscription(record, key, (cancel) =>
      this.#stop(key, cancel)
    );
    const active: Active = { sub, options, lastPersist: 0 };
    this.#active.set(key, active);
    this.#start(active);
    return sub as EventSubscription & AsyncIterable<EventEnvelope<T>>;
  }

  #context(active: Active, signal: AbortSignal): RunnerContext {
    const { sub } = active;
    const record = sub.record;
    const dedupeKey = `${record.server}\u0000${record.name}\u0000${record.argsKey}`;
    return {
      record,
      signal,
      connection: () => this.#init.connection(record.server),
      deliver: async (event) => {
        if (typeof event.eventId === "string") {
          if (record.recentEventIds.includes(event.eventId)) return;
          if (this.#lru.seen(`${dedupeKey}\u0000${event.eventId}`)) return;
          record.recentEventIds = pushRecentEventId(
            record.recentEventIds,
            event.eventId
          );
        }
        sub.push(event);
        try {
          await this.#init.onEvent?.(event, {
            server: record.server,
            subscription: sub,
          });
        } catch {
          /* a consumer error never stops the runner */
        }
      },
      setCursor: (cursor) => {
        if (cursor === record.cursor) return;
        record.cursor = cursor;
        this.#schedulePersist(active);
      },
      persist: () => this.#persist(active),
      gap: (g) => active.options.onGap?.(g),
      terminate: (t) => {
        active.options.onTerminated?.(t);
        this.#init.onEventsError?.(
          new EventsClientError(
            "terminated",
            `Subscription ${record.name} terminated`,
            {
              server: record.server,
              name: record.name,
              data: { ...t },
            }
          )
        );
      },
      error: (err) => this.#init.onEventsError?.(err),
    };
  }

  #start(active: Active): void {
    const { sub } = active;
    const signal = sub.signal;
    void (async () => {
      let exit: RunnerExit;
      for (;;) {
        const ctx = this.#context(active, signal);
        const record = sub.record;
        if (record.mode === "poll") {
          exit = await runPoll(ctx, active.options);
        } else if (record.mode === "push") {
          exit = await runPush(ctx, {
            ...active.options,
            ...(this.#init.activeTimeoutMs !== undefined
              ? { activeTimeoutMs: this.#init.activeTimeoutMs }
              : {}),
          });
        } else {
          const url = this.#receiverUrl();
          if (!url) {
            this.#init.onEventsError?.(
              new EventsClientError(
                "receiver_required",
                "Webhook mode needs a receiver",
                {
                  server: record.server,
                  name: record.name,
                }
              )
            );
            exit = { kind: "stopped" };
          } else {
            exit = await runWebhook(ctx, {
              receiverUrl: url,
              currentReceiverUrl: () => this.#receiverUrl() ?? url,
              ...(active.options.ttlMs !== undefined
                ? { ttlMs: active.options.ttlMs }
                : {}),
            });
          }
        }
        if (exit.kind !== "fallback" || signal.aborted) break;
        // push → poll (or webhook) fallback, remembered per server for the session.
        this.#pushFallback.add(record.server);
        let descriptor: EventDescriptor | undefined;
        try {
          descriptor = await this.#descriptor(record.server, record.name);
        } catch {
          descriptor = undefined;
        }
        const listed = descriptor?.delivery ?? [];
        const next: DeliveryMode | undefined = listed.includes("poll")
          ? "poll"
          : listed.includes("webhook") && this.#receiverUrl()
            ? "webhook"
            : undefined;
        if (!next) {
          this.#init.onEventsError?.(
            new EventsClientError(
              "mode_unavailable",
              "Push never became active and no fallback mode is offered",
              {
                server: record.server,
                name: record.name,
                data: { listed },
              }
            )
          );
          exit = { kind: "stopped" };
          break;
        }
        record.mode = next;
        await this.#persist(active);
      }
      if (exit.kind === "auth") {
        this.#init.onEventsError?.(
          new EventsClientError("auth_required", "Server returned 401", {
            server: sub.record.server,
            name: sub.record.name,
          })
        );
      }
      if (exit.kind === "terminated") {
        this.#active.delete(sub.key);
        await this.#store.delete(sub.key);
        sub.end();
      } else if (exit.kind === "auth") {
        await this.#persist(active);
        this.#active.delete(sub.key);
        sub.end();
      }
    })();
  }

  #schedulePersist(active: Active): void {
    if (active.persistTimer) return;
    const wait = Math.max(
      0,
      CURSOR_PERSIST_INTERVAL_MS - (Date.now() - active.lastPersist)
    );
    active.persistTimer = setTimeout(() => {
      active.persistTimer = undefined;
      void this.#persist(active);
    }, wait);
  }

  async #persist(active: Active): Promise<void> {
    if (active.persistTimer) {
      clearTimeout(active.persistTimer);
      active.persistTimer = undefined;
    }
    active.lastPersist = Date.now();
    if (!this.#active.has(active.sub.key)) return;
    await this.#store.set(active.sub.key, JSON.stringify(active.sub.record));
  }

  async #stop(key: string, cancel: boolean): Promise<void> {
    const active = this.#active.get(key);
    if (!active) {
      if (cancel) await this.#store.delete(key);
      return;
    }
    if (!cancel) await this.#persist(active);
    this.#active.delete(key);
    active.sub.end();
    if (active.persistTimer) clearTimeout(active.persistTimer);
    if (cancel) {
      if (active.sub.record.mode === "webhook") {
        try {
          await cancelWebhook({
            record: active.sub.record,
            connection: () => this.#init.connection(active.sub.record.server),
          });
        } catch {
          /* NotFound is success; other failures leave the server lease to expire */
        }
      }
      await this.#store.delete(key);
    }
  }

  /**
   * Resume persisted records of a server (call when its session opens).
   *
   * @param server - Server key.
   * @returns The resumed subscriptions.
   */
  async resume(server: string): Promise<EventSubscription[]> {
    if (this.#init.resume === "off") return [];
    const out: EventSubscription[] = [];
    await this.refreshList(server).catch(() => undefined);
    for (const key of await this.#store.list(`${RECORD_PREFIX}${server}/`)) {
      if (this.#active.has(key)) continue;
      const r = parseRecord(await this.#store.get(key));
      if (!r || r.server !== server) continue;
      try {
        out.push(await this.subscribe(server, r.name, r.args));
      } catch (err) {
        if (err instanceof EventsClientError) this.#init.onEventsError?.(err);
      }
    }
    return out;
  }

  /**
   * A webhook receiver pre-wired to this manager's records and runners.
   *
   * @returns The request handler.
   */
  createWebhookHandler(): (request: Request) => Promise<Response> {
    const bySubscriptionId = (id: string): Active | undefined => {
      for (const a of this.#active.values()) {
        if (a.sub.record.webhook?.subscriptionId === id) return a;
      }
      return undefined;
    };
    return createWebhookHandler({
      resolve: async (id) => {
        const a = bySubscriptionId(id);
        if (a?.sub.record.webhook) {
          const w = a.sub.record.webhook;
          return {
            state: "active",
            secrets: w.previousSecret
              ? [w.secret, w.previousSecret]
              : [w.secret],
          };
        }
        // A subscribe in flight has no id yet: accept its pending secret.
        const pending = [...this.#active.values()].filter(
          (x) =>
            x.sub.record.mode === "webhook" &&
            !x.sub.record.webhook?.subscriptionId
        );
        if (pending.length) {
          return {
            state: "pending",
            secrets: pending.flatMap((x) =>
              x.sub.record.webhook ? [x.sub.record.webhook.secret] : []
            ),
          };
        }
        return undefined;
      },
      bindPending: async () => true,
      onEvent: async (event, { subscriptionId }) => {
        const a = bySubscriptionId(subscriptionId);
        if (!a) return;
        await this.#context(a, a.sub.signal).deliver(event);
      },
      onCursor: async ({ subscriptionId, cursor }) => {
        const a = bySubscriptionId(subscriptionId);
        if (!a) return;
        a.sub.record.cursor = cursor;
        this.#schedulePersist(a);
      },
      onGap: async ({ subscriptionId, cursor }) => {
        const a = bySubscriptionId(subscriptionId);
        a?.options.onGap?.({ cursor, reason: "gap" });
      },
      onTerminated: async ({ subscriptionId, error }) => {
        const a = bySubscriptionId(subscriptionId);
        if (!a) return;
        this.#context(a, a.sub.signal).terminate({
          kind: "terminated",
          code: error.code,
          ...(error.data && typeof error.data === "object"
            ? { data: error.data as Record<string, unknown> }
            : {}),
        });
        this.#active.delete(a.sub.key);
        a.sub.end();
        await this.#store.delete(a.sub.key);
      },
    });
  }

  /** Stop every runner without unsubscribing; records stay persisted. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.#active.keys()].map((k) => this.#stop(k, false))
    );
  }
}

/**
 * Create the Events manager.
 *
 * @param init - Options and the connection resolver.
 * @returns The manager.
 */
export function createEventsManager(init: EventsManagerInit): EventsManager {
  return new EventsManager(init);
}
