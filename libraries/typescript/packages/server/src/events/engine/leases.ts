/**
 * Direct leases (D58, PLAN.md §8.12): drive `onSubscribe`/`onUnsubscribe`
 * for poll and push on events that define a hook.
 *
 * @internal
 */

import { EVENTS_DEFAULTS } from "../config.js";
import type { EventsBackend } from "../internal/backend.js";
import type { DirectLease, SubscriptionInfoSnapshot } from "../internal/records.js";
import type { EventsRegistry, RegisteredEvent } from "../internal/registry.js";
import type { SubscriptionInfo } from "../types.js";

/**
 * Lease TTL: `max(5 min, 3 × nextPollMs)`.
 *
 * @param nextPollMs - The event's poll interval.
 */
export function leaseTtlMs(nextPollMs: number): number {
  return Math.max(EVENTS_DEFAULTS.leaseTtlMinMs, 3 * nextPollMs);
}

/** Enqueues a durable hook job (D64). */
export type HookEnqueuer = (
  reason: "expired",
  snapshot: SubscriptionInfoSnapshot
) => Promise<void>;

/** Process-local touch cache: lease writes happen at most every `ttl/2`. */
export class LeaseToucher {
  readonly #lastTouch = new Map<string, number>();

  /**
   * @param backend - The engine backend.
   * @param deleteLease - Removes a lease whose `onSubscribe` threw (rollback).
   */
  constructor(
    private readonly backend: Pick<EventsBackend, "touchLease">,
    private readonly deleteLease: (id: string) => Promise<void>
  ) {}

  /**
   * Touches the lease of `(principal, name, args)` for events with hooks.
   * The first touch runs `onSubscribe` inline; a throw rolls the lease back
   * and propagates.
   *
   * @returns Whether a storage write happened.
   */
  async touch(o: {
    ev: RegisteredEvent;
    id: string;
    principal: string;
    args: Record<string, unknown>;
    mode: "poll" | "push";
    nextPollMs: number;
    now: number;
    onSubscribe(info: SubscriptionInfo<Record<string, unknown>>): Promise<void>;
  }): Promise<boolean> {
    if (!o.ev.hooks.onSubscribe && !o.ev.hooks.onUnsubscribe) return false;
    const ttl = leaseTtlMs(o.nextPollMs);
    const key = `${o.id}|${o.mode}`;
    const last = this.#lastTouch.get(key);
    if (last !== undefined && o.now - last < ttl / 2) return false;
    const { created, lease } = await this.backend.touchLease({
      id: o.id,
      name: o.ev.name,
      principal: o.principal,
      args: o.args,
      mode: o.mode,
      ttlMs: ttl,
    });
    this.#lastTouch.set(key, o.now);
    if (created && o.ev.hooks.onSubscribe) {
      try {
        await o.onSubscribe({
          id: o.id,
          name: o.ev.name,
          args: o.args,
          principal: o.principal,
          dialect: "sep-3415",
          mode: o.mode,
          callbackOrigin: null,
          expiresAt: new Date(lease.expiresAt),
          created: true,
        });
      } catch (err) {
        this.#lastTouch.delete(key);
        await this.deleteLease(o.id);
        throw err;
      }
    }
    return true;
  }
}

/** The hook snapshot of an expired lease. */
export function leaseSnapshot(lease: DirectLease): SubscriptionInfoSnapshot {
  return {
    id: lease.id,
    name: lease.name,
    args: lease.args,
    principal: lease.principal,
    dialect: "sep-3415",
    mode: lease.modes.includes("push") ? "push" : "poll",
    callbackOrigin: null,
    expiresAt: lease.expiresAt,
  };
}

/**
 * Enqueues `onUnsubscribe(…, "expired")` hook jobs for expired leases. The
 * backend keeps the records until `expiresAt + 7 d` and must not return a
 * lease twice.
 *
 * @returns The number of expired leases handled.
 */
export async function sweepLeases(deps: {
  backend: Pick<EventsBackend, "expiredLeases">;
  registry: EventsRegistry;
  enqueueHook: HookEnqueuer;
  limit?: number;
}): Promise<number> {
  const expired = await deps.backend.expiredLeases(deps.limit ?? 100);
  for (const lease of expired) {
    if (deps.registry.get(lease.name)?.hooks.onUnsubscribe !== false)
      await deps.enqueueHook("expired", leaseSnapshot(lease));
  }
  return expired.length;
}
