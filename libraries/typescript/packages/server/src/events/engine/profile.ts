/**
 * Profile resolution for a request (PLAN.md D7, D53). The D7 order itself is
 * `resolveProfile` in `@mcp-use/events-core`; this module adapts the server
 * configuration to it, pins `{preset, revision, axes, via}` and applies the
 * D53 stored-profile rules.
 *
 * @internal
 */

import {
  parseStoredProfile,
  resolveProfile,
  storedProfileStatus,
  type AdvertiseKeys,
  type CompatibilityConfig,
  type EventsSignals,
  type ResolvedProfile,
  type StoredProfileStatus,
} from "@mcp-use/events-core";
import type { EventsConfig } from "../config.js";
import type { StoredProfilePin } from "../internal/records.js";

/** `EventsConfig.compatibility`. */
export type ServerCompatibility = NonNullable<EventsConfig["compatibility"]>;

/**
 * Resolves the profile of one request in the D7 order.
 *
 * @param signals - The request signals.
 * @param compatibility - `events.compatibility`.
 * @param method - The JSON-RPC method (step 4 and 7 read it).
 * @returns The resolved profile.
 * @throws `UnknownPresetError` when configuration names an unknown preset.
 */
export function resolveRequestProfile(
  signals: EventsSignals,
  compatibility: ServerCompatibility | undefined,
  method?: string
): ResolvedProfile {
  return resolveProfile(
    signals,
    compatibility as CompatibilityConfig | undefined,
    method === undefined ? {} : { method }
  );
}

/**
 * The stored pin of a resolved profile.
 *
 * @param p - The resolved profile.
 * @returns `{preset, revision, axes, via}`; `via` carries the row id for known clients.
 */
export function pinProfile(p: ResolvedProfile): StoredProfilePin {
  return {
    preset: p.preset,
    revision: p.revision,
    axes: { ...p.axes },
    via: p.via === "known-client" && p.row ? `known-client:${p.row.id}` : p.via,
  };
}

/**
 * The `Mcp-Name` policy for a request: the matched row's, else the config's,
 * else `lenient` (D9).
 *
 * @param p - The resolved profile.
 * @param compatibility - `events.compatibility`.
 * @returns The policy.
 */
export function mcpNamePolicy(
  p: ResolvedProfile,
  compatibility: ServerCompatibility | undefined
): "lenient" | "strict" {
  return p.row?.mcpName ?? compatibility?.mcpName ?? "lenient";
}

/**
 * Capability keys a modern `server/discover` advertises (D8): the matched
 * row's `advertise`, else both; `openai: false` drops the top-level key.
 *
 * @param p - The resolved profile.
 * @param compatibility - `events.compatibility`.
 * @returns `both`, `top` or `extension`.
 */
export function advertiseKeys(
  p: ResolvedProfile,
  compatibility: ServerCompatibility | undefined
): AdvertiseKeys {
  if (compatibility?.openai === false) return "extension";
  return p.row?.advertise ?? "both";
}

/** D53 decision on a stored profile. */
export type StoredProfileDecision =
  | { status: "known" | "deliverable"; pin: StoredProfilePin }
  | { status: "unknown" | "broken" };

/**
 * Classifies a stored profile (D53): deliver as stored, deliver with stored
 * axes, or skip (`profile_unknown`) until the next refresh re-resolves it.
 *
 * @param raw - `record.profile` as read.
 * @returns The decision; the pin is returned unchanged.
 */
export function classifyStoredProfile(raw: unknown): StoredProfileDecision {
  const p = parseStoredProfile(raw);
  if (!p) return { status: "broken" };
  const status: StoredProfileStatus = storedProfileStatus(p);
  return status === "unknown"
    ? { status }
    : { status, pin: p as StoredProfilePin };
}
