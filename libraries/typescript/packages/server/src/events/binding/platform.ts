/**
 * The platform binding (PLAN.md §8.5, D62): `MCP_USE_PLATFORM_*` read as one
 * unit. A missing required piece fails closed with
 * `EVENTS_PLATFORM_BINDING_INCOMPLETE {missing}`.
 *
 * @internal
 */

import type { StorageUrlTarget } from "../../storage/url.js";
import { missingPlatformBinding, type EventsEnvSnapshot } from "../env.js";
import { EventsConfigError } from "../errors.js";

/** A validated platform binding, before storage is opened. */
export interface PlatformBindingPlan {
  target: StorageUrlTarget;
  namespace: string;
  keyring: string[];
  /** `MCP_USE_PLATFORM_NAME`, for `binding=platform(<name>)`. */
  name?: string;
  /** One startup warning when user namespace or keyring values are ignored. */
  warning?: string;
}

/** Whether a platform storage URL needs a token (Upstash REST forms). */
export function platformUrlNeedsToken(url: string | undefined): boolean {
  if (url === undefined) return true;
  return url === "upstash" || /^https?:\/\//i.test(url);
}

/**
 * Validate the platform binding and plan its storage. Returns undefined when
 * no platform variable is set.
 *
 * @param snapshot - Parsed environment.
 * @param ignoredUser - Whether user namespace or keyring values were given (they are ignored).
 * @throws EventsConfigError `EVENTS_PLATFORM_BINDING_INCOMPLETE`.
 */
export function planPlatformBinding(
  snapshot: EventsEnvSnapshot,
  ignoredUser = false
): PlatformBindingPlan | undefined {
  const p = snapshot.platform;
  if (!p.present) return undefined;
  const missing = missingPlatformBinding(
    p,
    platformUrlNeedsToken(p.storageUrl)
  );
  if (missing.length > 0)
    throw new EventsConfigError(
      "EVENTS_PLATFORM_BINDING_INCOMPLETE",
      `events: the platform binding is incomplete; missing ${missing.join(", ")}.`,
      { missing }
    );
  const url = p.storageUrl as string;
  const prefix = p.storagePrefix ?? "";
  let target: StorageUrlTarget;
  if (url === "memory") target = { kind: "memory", prefix };
  else if (/^rediss?:\/\//i.test(url)) target = { kind: "redis", url, prefix };
  else
    target = {
      kind: "upstash",
      url,
      token: p.storageToken as string,
      prefix,
    };
  const plan: PlatformBindingPlan = {
    target,
    namespace: p.namespace as string,
    keyring: [...(p.secret as string[])],
  };
  if (snapshot.platformName !== undefined) plan.name = snapshot.platformName;
  if (ignoredUser)
    plan.warning =
      "events: platform binding active; events.namespace, events.secret and user keyring variables are ignored.";
  return plan;
}
