/**
 * The sweeper (PLAN.md §8.17): runs under a leader lease, expires records
 * (7 d retention, in the backend), sweeps direct leases (WP-18) and removes
 * events missing from the catalog for 24 h (D32).
 *
 * @internal
 */

import { EVENTS_DEFAULTS } from "../config.js";
import type { EventsBackend, ProcessDeps } from "../internal/backend.js";
import type { EventsRegistry } from "../internal/registry.js";
import { dueForRemoval, eventRemovedError, type CatalogStore } from "./catalog-lifecycle.js";
import { sweepLeases, type HookEnqueuer } from "./leases.js";
import { revoke } from "./revoke.js";

/** A cluster-wide leader lease. */
export interface LeaderLease {
  /** Acquires or extends the lease for `owner`; true when held. */
  tryAcquire(owner: string, ttlMs: number): Promise<boolean>;
}

/** What one sweep did. */
export interface SweepReport {
  leader: boolean;
  expired: number;
  leasesExpired: number;
  removedEvents: string[];
}

/**
 * Runs one sweep if this instance holds (or wins) the leader lease.
 */
export async function runSweep(deps: {
  backend: EventsBackend;
  registry: EventsRegistry;
  process: ProcessDeps;
  leader: LeaderLease;
  catalog?: CatalogStore;
  enqueueHook: HookEnqueuer;
  now(): number;
}): Promise<SweepReport> {
  const report: SweepReport = {
    leader: false,
    expired: 0,
    leasesExpired: 0,
    removedEvents: [],
  };
  if (!(await deps.leader.tryAcquire(deps.process.owner, EVENTS_DEFAULTS.sweeperLeaseMs)))
    return report;
  report.leader = true;
  report.expired = (await deps.backend.sweep(deps.process)).expired;
  report.leasesExpired = await sweepLeases({
    backend: deps.backend,
    registry: deps.registry,
    enqueueHook: deps.enqueueHook,
  });
  if (deps.catalog) {
    const missing = await deps.catalog.readMissing();
    const due = dueForRemoval(missing, deps.now());
    for (const name of due) {
      // TODO(events): the backend needs a "revoke by name" filter without a principal; WP-20 owns RevokeFilterInternal semantics.
      await revoke(
        { name, principal: "*", reason: "terminated" },
        {
          backend: deps.backend,
          registry: deps.registry,
          now: deps.now,
          error: eventRemovedError(),
        }
      );
      delete missing[name];
      report.removedEvents.push(name);
    }
    if (due.length > 0) await deps.catalog.writeMissing(missing);
  }
  return report;
}
