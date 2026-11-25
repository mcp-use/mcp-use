/**
 * `assertServerConfig` additions for Events (PLAN.md §7.4): shape checks of
 * `ServerConfig.events` that do not need storage. Throws
 * `EVENTS_CONFIG_INVALID {field}`.
 *
 * @internal
 */

import type { EventsConfig } from "../config.js";
import { EventsConfigError } from "../errors.js";

function bad(field: string, expected: string): never {
  throw new EventsConfigError(
    "EVENTS_CONFIG_INVALID",
    `events.${field} is invalid: expected ${expected}.`,
    { field: `events.${field}` }
  );
}

function secretList(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((s) => typeof s === "string" && s.trim() !== "")
  );
}

/**
 * Validate `ServerConfig.events`.
 *
 * @param config - The Events config, or undefined.
 */
export function validateEventsConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- user type erased
  config: EventsConfig<any> | undefined
): void {
  if (config === undefined) return;
  if (typeof config !== "object" || config === null) bad("", "an object");
  if (
    config.namespace !== undefined &&
    (typeof config.namespace !== "string" || config.namespace.trim() === "")
  )
    bad("namespace", "a non-empty string");
  if (config.secret !== undefined && !secretList(config.secret))
    bad("secret", "a non-empty string or list of strings");
  if (
    config.worker !== undefined &&
    config.worker !== "auto" &&
    config.worker !== "off"
  )
    bad("worker", '"auto" or "off"');
  if (
    config.logFormat !== undefined &&
    config.logFormat !== "text" &&
    config.logFormat !== "json"
  )
    bad("logFormat", '"text" or "json"');
  if (config.admin?.secret !== undefined && !secretList(config.admin.secret))
    bad("admin.secret", "a non-empty string or list of strings");
  if (config.tick?.secret !== undefined && !secretList(config.tick.secret))
    bad("tick.secret", "a non-empty string or list of strings");
  if (config.waitUntil !== undefined && typeof config.waitUntil !== "function")
    bad("waitUntil", "a function");
  if (config.onLog !== undefined && typeof config.onLog !== "function")
    bad("onLog", "a function");
}
