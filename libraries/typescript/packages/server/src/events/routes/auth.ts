/**
 * Internal route auth (D41): bearer secrets as comma lists, the dev token,
 * never the bind address or `Host`. Routes are disabled without a secret
 * outside the dev runtime.
 *
 * @internal
 */

import type { EventsRouteAuth } from "./contract.js";

/** Accepted bearers. */
export interface RouteAuthConfig {
  /** `MCP_USE_EVENTS_TICK_SECRET` (or `events.tick.secret`), else `CRON_SECRET`. */
  tick: readonly string[];
  /** User admin secrets plus platform admin secrets. */
  admin: readonly string[];
  /** Dev token, only while the CLI dev runtime is active. */
  devToken?: string;
}

/** Outcome of {@link authorizeRoute}. */
export type AuthOutcome = "ok" | "unauthorized" | "disabled";

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < ea.length; i++)
    diff |= ea[i]! ^ (eb[i % Math.max(eb.length, 1)] ?? 0);
  return diff === 0;
}

/** Extract the bearer token. */
export function bearer(request: Request): string | undefined {
  const h = request.headers.get("authorization");
  if (h === null) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim();
}

/**
 * Authorize a request for an auth class.
 *
 * @param request - The request.
 * @param auth - Route auth class.
 * @param cfg - Accepted bearers.
 */
export function authorizeRoute(
  request: Request,
  auth: EventsRouteAuth,
  cfg: RouteAuthConfig
): AuthOutcome {
  const accepted: string[] = [...cfg.admin];
  if (auth === "tick") accepted.push(...cfg.tick);
  const dev = auth !== "admin-no-dev" ? cfg.devToken : undefined;
  if (dev !== undefined) accepted.push(dev);
  if (accepted.length === 0) return "disabled";
  const token = bearer(request);
  if (token === undefined) return "unauthorized";
  let ok = false;
  for (const s of accepted) if (safeEqual(token, s)) ok = true;
  return ok ? "ok" : "unauthorized";
}
