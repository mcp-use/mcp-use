/**
 * `POST admin/decommission` (D68): write `closed`, revoke everything, end
 * open streams and polls with `{all:true}` control entries, drain control
 * and hook jobs until done or the deadline, purge, and rewrite `closed`
 * with a 7 d TTL. Idempotent.
 *
 * @internal
 */

import type { McpUseStorage } from "../../storage/types.js";
import { purgeNamespace } from "../admin/purge.js";
import type { AdminKeys } from "../admin/status.js";
import type {
  DecommissionRouteRequest,
  DecommissionRouteResponse,
} from "./contract.js";

/** Default and maximum deadline. */
export const DECOMMISSION_DEFAULT_MS = 60_000;
/** Maximum deadline. */
export const DECOMMISSION_MAX_MS = 120_000;

/** Engine steps decommission drives. */
export interface DecommissionSteps {
  /** Revoke every subscription with reason `"closed"`; counts `terminated` control jobs and hook jobs. */
  revokeAll(reason: string): Promise<{ terminated: number; hooks: number }>;
  /** Append `{all:true}` control entries to every event log. */
  closeLogs(): Promise<void>;
  /** Process control and hook jobs until done or the deadline; returns jobs left undelivered. */
  drain(deadlineAt: number): Promise<{ undelivered: number }>;
}

/**
 * Validate a decommission body.
 *
 * @param body - Parsed JSON.
 * @returns The body, or an error message.
 */
export function parseDecommissionBody(
  body: unknown
):
  | { ok: true; value: { reason: string; deadlineMs: number } }
  | { ok: false; message: string } {
  const b = (body ?? {}) as DecommissionRouteRequest;
  if (typeof b !== "object")
    return { ok: false, message: "body must be an object" };
  if (b.reason !== undefined && typeof b.reason !== "string")
    return { ok: false, message: "reason must be a string" };
  const d = b.deadlineMs ?? DECOMMISSION_DEFAULT_MS;
  if (
    typeof d !== "number" ||
    !Number.isFinite(d) ||
    d < 0 ||
    d > DECOMMISSION_MAX_MS
  )
    return {
      ok: false,
      message: `deadlineMs must be between 0 and ${DECOMMISSION_MAX_MS}`,
    };
  return { ok: true, value: { reason: b.reason ?? "closed", deadlineMs: d } };
}

/**
 * Run decommission.
 *
 * @param storage - Prefixed storage.
 * @param keys - Admin keys.
 * @param steps - Engine steps.
 * @param req - Reason and deadline.
 * @param now - Clock.
 */
export async function runDecommission(
  storage: McpUseStorage,
  keys: AdminKeys,
  steps: DecommissionSteps,
  req: { reason: string; deadlineMs: number },
  now: () => number = Date.now
): Promise<DecommissionRouteResponse> {
  const start = now();
  await storage.write(
    keys.closed,
    JSON.stringify({ at: start, reason: req.reason })
  );
  const { terminated, hooks } = await steps.revokeAll("closed");
  await steps.closeLogs();
  const { undelivered } = await steps.drain(start + req.deadlineMs);
  const { deletedKeys } = await purgeNamespace(
    storage,
    keys,
    req.reason,
    now()
  );
  // purgeNamespace rewrote `closed` with the 7 d TTL.
  return { terminated, hooks, undelivered, purged: deletedKeys };
}
