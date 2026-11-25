/**
 * `agent.onEvent` (PLAN.md §9.7): run the agent when an MCP event arrives,
 * through the client Events manager, with `<untrusted-mcp-event>` wrapping,
 * optional coalescing, one run at a time and an hourly run cap.
 *
 * @packageDocumentation
 */

import { logger } from "@mcp-use/client";

/** A delivery mode (`@mcp-use/events-core` `DeliveryMode`). */
export type DeliveryMode = "webhook" | "push" | "poll";

/** The event envelope fields a trigger uses (`@mcp-use/events-core` `EventEnvelope`). */
export interface EventEnvelope<T = unknown> {
  /** Event id. */
  eventId: string;
  /** Event name. */
  name: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Untrusted payload. */
  data: T;
  /** Resume cursor. */
  cursor?: string | null;
}

/** An event as seen by the prompt builder. */
export interface AgentEvent<T = unknown> {
  /** The envelope (its `data` is untrusted). */
  event: EventEnvelope<T>;
  /** Every event of a coalesced batch, oldest first. */
  batch: ReadonlyArray<EventEnvelope<T>>;
  /** The batch wrapped as `<untrusted-mcp-event …>…</untrusted-mcp-event>` blocks. */
  untrusted: string;
}

/** Options of `agent.onEvent`. */
export interface OnEventOptions<T = unknown> {
  /** Build the prompt; interpolate only `e.untrusted`, never raw `data`. */
  prompt: (e: AgentEvent<T>) => string;
  /** Force a delivery mode; default: the manager's choice. */
  mode?: DeliveryMode;
  /** Batch bursts into one run, for example `"30s"` or `30_000`. */
  coalesce?: string | number;
  /** Feedback-loop guard; excess events are dropped with a log line. Default 30. */
  maxRunsPerHour?: number;
}

/** A running trigger. */
export interface EventTrigger {
  /** Stop the trigger (the subscription is closed, not cancelled). */
  stop(): Promise<void>;
}

/** The part of the client Events manager a trigger uses. */
export interface EventsSubscriber {
  subscribe(
    server: string,
    name: string,
    args: Record<string, unknown>,
    options?: { mode?: DeliveryMode }
  ): Promise<AsyncIterable<EventEnvelope> & { close(): Promise<void> }>;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeBody(s: string): string {
  // Neutralise any attempt to close the wrapper from inside the data.
  return s.replace(/<\/?untrusted-mcp-event/gi, (m) => m.replace("<", "&lt;"));
}

/**
 * Wrap events as untrusted blocks.
 *
 * @param server - Server key.
 * @param events - The events.
 * @returns The wrapped text.
 */
export function wrapUntrusted(
  server: string,
  events: ReadonlyArray<EventEnvelope>
): string {
  return events
    .map(
      (e) =>
        `<untrusted-mcp-event server="${escapeAttr(server)}" name="${escapeAttr(e.name)}">${escapeBody(
          JSON.stringify(e.data)
        )}</untrusted-mcp-event>`
    )
    .join("\n");
}

/**
 * Parse a coalesce window.
 *
 * @param v - `"30s"`, `"2m"`, `"500ms"` or milliseconds.
 * @returns Milliseconds (0 = no coalescing).
 */
export function parseDuration(v: string | number | undefined): number {
  if (v === undefined) return 0;
  if (typeof v === "number") return Math.max(0, v);
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/.exec(v.trim());
  if (!m) throw new Error(`Invalid duration: ${v}`);
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[m[2] as "ms"];
  return n * unit;
}

/**
 * Start an event trigger.
 *
 * @param o - Subscriber, target, options and the run function.
 * @returns The trigger.
 */
export async function startEventTrigger<T = unknown>(o: {
  events: EventsSubscriber;
  server: string;
  name: string;
  args: Record<string, unknown>;
  options: OnEventOptions<T>;
  run: (prompt: string) => Promise<unknown>;
  now?: () => number;
}): Promise<EventTrigger> {
  const now = o.now ?? Date.now;
  const cap = o.options.maxRunsPerHour ?? 30;
  const windowMs = parseDuration(o.options.coalesce);
  const runs: number[] = [];
  let buffer: EventEnvelope<T>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;

  const sub = await o.events.subscribe(o.server, o.name, o.args, {
    ...(o.options.mode ? { mode: o.options.mode } : {}),
  });

  const fire = () => {
    timer = undefined;
    const batch = buffer;
    buffer = [];
    if (batch.length === 0 || stopped) return;
    const t = now();
    while (runs.length && t - runs[0]! > 3_600_000) runs.shift();
    if (runs.length >= cap) {
      logger.warn(
        `[events] onEvent ${o.server}/${o.name}: maxRunsPerHour (${cap}) reached; dropped ${batch.length} event(s)`
      );
      return;
    }
    runs.push(t);
    const prompt = o.options.prompt({
      event: batch[batch.length - 1]!,
      batch,
      untrusted: wrapUntrusted(o.server, batch),
    });
    // One run at a time per trigger.
    chain = chain.then(async () => {
      try {
        await o.run(prompt);
      } catch (err) {
        logger.error(`[events] onEvent ${o.server}/${o.name} run failed:`, err);
      }
    });
  };

  void (async () => {
    for await (const e of sub) {
      if (stopped) break;
      buffer.push(e as EventEnvelope<T>);
      if (windowMs === 0) fire();
      else if (!timer) timer = setTimeout(fire, windowMs);
    }
  })();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await sub.close();
      await chain;
    },
  };
}
