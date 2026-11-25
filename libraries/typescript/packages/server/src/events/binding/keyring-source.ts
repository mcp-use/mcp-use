/**
 * Keyring sources (PLAN.md §8.5, D22). User binding: `events.secret` →
 * `MCP_USE_EVENTS_SECRET` → `MCP_USE_SECRET` → `MCP_USE_OAUTH_SECRET`;
 * platform binding: `MCP_USE_PLATFORM_SECRET` only. Keyrings are lists: the
 * first key seals, all keys open.
 *
 * @internal
 */

import type { EventsEnvSnapshot } from "../env.js";

/** Where a keyring came from. */
export type KeyringSource =
  | "config"
  | "MCP_USE_EVENTS_SECRET"
  | "MCP_USE_SECRET"
  | "MCP_USE_OAUTH_SECRET"
  | "MCP_USE_PLATFORM_SECRET"
  | "none";

/** A resolved keyring. */
export interface ResolvedKeyring {
  keys: string[];
  source: KeyringSource;
}

/**
 * Normalize a secret option (string, comma list or array) into a keyring.
 *
 * @param secret - `events.secret`.
 */
export function toKeyring(
  secret: string | readonly string[] | undefined
): string[] {
  if (secret === undefined) return [];
  const list = typeof secret === "string" ? secret.split(",") : [...secret];
  return list.map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * The user-binding keyring.
 *
 * @param configSecret - `events.secret`.
 * @param snapshot - Parsed environment.
 */
export function resolveUserKeyring(
  configSecret: string | readonly string[] | undefined,
  snapshot: EventsEnvSnapshot
): ResolvedKeyring {
  const fromConfig = toKeyring(configSecret);
  if (fromConfig.length > 0) return { keys: fromConfig, source: "config" };
  const k = snapshot.user.keyring;
  if (k !== undefined) return { keys: [...k.keys], source: k.source };
  return { keys: [], source: "none" };
}

/**
 * The platform-binding keyring (`MCP_USE_PLATFORM_SECRET` only).
 *
 * @param snapshot - Parsed environment.
 */
export function resolvePlatformKeyring(
  snapshot: EventsEnvSnapshot
): ResolvedKeyring {
  const s = snapshot.platform.secret;
  return s === undefined
    ? { keys: [], source: "none" }
    : { keys: [...s], source: "MCP_USE_PLATFORM_SECRET" };
}

/** A printable random secret for the `EVENTS_SECRET_REQUIRED` message. */
export function generateSecretSuggestion(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
