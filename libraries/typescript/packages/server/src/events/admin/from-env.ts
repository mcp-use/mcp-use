/**
 * `openEventsAdminFromEnv` (§8.5): the user binding from
 * `MCP_USE_STORAGE_URL`, then the platform binding; never dev or memory.
 *
 * @internal
 */

import { isMcpUseStorage } from "../../storage/types.js";
import { openStorageUrl, parseStorageUrl } from "../../storage/url.js";
import { planPlatformBinding } from "../binding/platform.js";
import { readEventsEnv } from "../env.js";
import { EventsConfigError } from "../errors.js";
import { openEventsAdmin } from "./open.js";
import type { EventsAdmin } from "./types.js";

/**
 * Same resolution as the server (user binding, then platform binding); never
 * dev or memory.
 *
 * @param env - Environment; default `process.env`.
 * @returns The admin handle.
 * @throws EventsConfigError `EVENTS_STORAGE_REQUIRED` when no binding is set,
 * `EVENTS_PLATFORM_BINDING_INCOMPLETE` for a partial platform binding.
 */
export async function openEventsAdminFromEnv(
  env?: Record<string, string | undefined>
): Promise<EventsAdmin> {
  const e =
    env ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env ??
    {};
  const snap = readEventsEnv(e);
  const user = parseStorageUrl(e);
  if (user !== undefined && user.kind !== "memory") {
    const storage = await openStorageUrl(user);
    if (!isMcpUseStorage(storage))
      throw new EventsConfigError(
        "STORAGE_UNSUPPORTED",
        "events admin: the store does not implement McpUseStorage."
      );
    if (snap.user.namespace === undefined)
      throw new EventsConfigError(
        "EVENTS_CONFIG_INVALID",
        "events admin: set MCP_USE_EVENTS_NAMESPACE to open the user binding.",
        { field: "MCP_USE_EVENTS_NAMESPACE" }
      );
    const keys = snap.user.keyring?.keys;
    return openEventsAdmin(
      keys === undefined
        ? { storage, namespace: snap.user.namespace }
        : { storage, namespace: snap.user.namespace, secret: keys }
    );
  }
  const platform = planPlatformBinding(snap);
  if (platform !== undefined) {
    const storage = await openStorageUrl(platform.target);
    if (!isMcpUseStorage(storage))
      throw new EventsConfigError(
        "STORAGE_UNSUPPORTED",
        "events admin: the store does not implement McpUseStorage."
      );
    return openEventsAdmin({
      storage,
      namespace: platform.namespace,
      secret: platform.keyring,
    });
  }
  throw new EventsConfigError(
    "EVENTS_STORAGE_REQUIRED",
    "events admin: no store binding; set MCP_USE_STORAGE_URL or the MCP_USE_PLATFORM_* binding."
  );
}
