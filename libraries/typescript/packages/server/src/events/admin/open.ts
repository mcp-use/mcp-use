/**
 * `openEventsAdmin` (D66): the single implementation of state reads and
 * admin mutations. Edge-safe; holds no event definitions.
 *
 * @internal
 */

import { ns16 } from "../binding/namespace.js";
import { toKeyring } from "../binding/keyring-source.js";
import { EventsConfigError } from "../errors.js";
import { systemClock } from "../internal/clock.js";
import type { RevokeFilterInternal } from "../internal/backend.js";
import { storageBackend } from "../storage-backend.js";
import { purgeNamespace } from "./purge.js";
import { redeliverDeadLetter } from "./redeliver.js";
import { rekeyNamespace } from "./rekey.js";
import {
  adminKeys,
  readNextWakeAt,
  readStatus,
  type AdminKeys,
} from "./status.js";
import type { EventsAdmin, EventsBinding } from "./types.js";
import {
  keylessCodec,
  viewCatalog,
  viewDeadLetters,
  viewLeases,
  viewSubscription,
  viewSubscriptions,
  type AdminCodec,
  type ViewContext,
} from "./views.js";

/** Internal overrides (tests, the app's routes, the dev binding). */
export interface AdminInternals {
  /** Record codec; default: keyless without a secret, WP-12 sealing with one. */
  codec?: AdminCodec;
  /** Revoke implementation; default `storageBackend(...).revoke`. */
  revoke?: (f: RevokeFilterInternal) => Promise<{ removed: number }>;
  /** Clock in ms. */
  now?: () => number;
}

function sealedCodec(keyring: readonly string[]): AdminCodec {
  void keyring;
  // TODO(events): WP-12 — build the AES-GCM codec (store/seal + store/codec)
  // from the keyring. Until then keyed reads of a sealed store fail clearly.
  return {
    open: () =>
      Promise.reject(
        new EventsConfigError(
          "EVENTS_BACKEND_UNAVAILABLE",
          "events admin: record sealing is not available in this build (WP-12)."
        )
      ),
    seal: () =>
      Promise.reject(
        new EventsConfigError(
          "EVENTS_BACKEND_UNAVAILABLE",
          "events admin: record sealing is not available in this build (WP-12)."
        )
      ),
  };
}

/**
 * Open the admin library with internal overrides.
 *
 * @param binding - Storage, namespace and optional keyring.
 * @param internals - Codec, revoke and clock overrides.
 */
export function openEventsAdminWith(
  binding: EventsBinding,
  internals: AdminInternals = {}
): EventsAdmin {
  const keyring = toKeyring(binding.secret);
  const codec =
    internals.codec ??
    (keyring.length === 0 ? keylessCodec : sealedCodec(keyring));
  const now = internals.now ?? Date.now;
  const storage = binding.storage;
  let keysP: Promise<AdminKeys> | undefined;
  const keys = () => (keysP ??= ns16(binding.namespace).then(adminKeys));
  const requireKey = () => {
    if (keyring.length === 0 && internals.codec === undefined)
      throw new EventsConfigError(
        "EVENTS_SECRET_REQUIRED",
        "events admin: this operation needs the namespace keyring (EventsBinding.secret)."
      );
  };
  const ctx = async (): Promise<ViewContext> => {
    requireKey();
    return { storage, keys: await keys(), codec };
  };
  const revoke =
    internals.revoke ??
    (async (f: RevokeFilterInternal) => {
      requireKey();
      const backend = storageBackend({
        storage,
        namespace: binding.namespace,
        keyring,
        durable: storage.durable,
        shared: storage.shared,
        clock: systemClock,
      });
      const r = await backend.revoke(f, { now: now() });
      return { removed: r.removed.length };
    });

  return {
    namespace: binding.namespace,
    async status() {
      return readStatus(storage, await keys(), now());
    },
    async nextWakeAt() {
      return readNextWakeAt(storage, await keys());
    },
    async catalog() {
      return viewCatalog(await ctx());
    },
    async subscriptions(q) {
      return viewSubscriptions(await ctx(), q);
    },
    async subscription(id) {
      return viewSubscription(await ctx(), id);
    },
    async leases(q) {
      return viewLeases(await ctx(), q);
    },
    async deadLetters(q) {
      return viewDeadLetters(await ctx(), q);
    },
    async redeliver(id) {
      return redeliverDeadLetter(await ctx(), id, now());
    },
    async revoke(filter) {
      if (filter.principal === undefined && filter.subscriptionId === undefined)
        throw new EventsConfigError(
          "EVENTS_CONFIG_INVALID",
          "events admin: revoke needs principal or subscriptionId.",
          { field: "filter" }
        );
      return revoke(filter);
    },
    async rekey(options) {
      requireKey();
      return rekeyNamespace(await ctx(), options?.budgetMs, now);
    },
    async purge() {
      return purgeNamespace(storage, await keys(), "purged", now());
    },
  };
}

/**
 * Open the admin library over a store binding. Key-less operations
 * (`status`, `nextWakeAt`, `purge`) work without `secret`; the others need
 * it.
 *
 * @param binding - Storage (already prefixed), namespace and optional keyring.
 * @returns The admin handle.
 */
export function openEventsAdmin(binding: EventsBinding): EventsAdmin {
  return openEventsAdminWith(binding);
}
