/**
 * Internal route dispatcher under `{basePath}/_mcp-use/events/` (D41),
 * outside the OAuth gate. Unknown paths return undefined; routes without
 * any accepted secret answer 404.
 *
 * @internal
 */

import type { EventsAdmin } from "../admin/types.js";
import type { EventsHealth, StreamView, TickReport } from "../types.js";
import { handleAdmin } from "./admin.js";
import { authorizeRoute, type RouteAuthConfig } from "./auth.js";
import {
  EVENTS_ROUTE_PREFIX,
  EVENTS_ROUTES,
  type EventsRouteSpec,
} from "./contract.js";
import { parseDecommissionBody } from "./decommission.js";
import { handleEmit, routeError, type EmitRouteDeps } from "./emit.js";
import { handleHealth } from "./health.js";
import { handleTick, json } from "./tick.js";

/** What the router needs from the Events host. */
export interface EventsRoutesDeps {
  basePath: () => string;
  auth: () => RouteAuthConfig;
  tick: () => Promise<TickReport>;
  health: () => Promise<EventsHealth>;
  emit: () => Promise<EmitRouteDeps>;
  admin: () => Promise<EventsAdmin>;
  streams: () => Promise<StreamView[]>;
  decommission: (body: {
    reason: string;
    deadlineMs: number;
  }) => Promise<unknown>;
}

/** A matched route. */
export interface RouteMatch {
  spec: EventsRouteSpec;
  params: Record<string, string>;
}

/**
 * Match a pathname against the route table.
 *
 * @param pathname - Request path.
 * @param basePath - MCP base path.
 */
export function matchEventsRoute(
  pathname: string,
  basePath: string
): RouteMatch | "prefix" | undefined {
  const root = `${basePath.replace(/\/+$/, "")}${EVENTS_ROUTE_PREFIX}/`;
  if (!pathname.startsWith(root)) return undefined;
  const rest = pathname.slice(root.length).split("/");
  for (const spec of EVENTS_ROUTES) {
    const parts = spec.path.split("/");
    if (parts.length !== rest.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    parts.forEach((p, i) => {
      const seg = rest[i] ?? "";
      if (p.startsWith(":")) {
        if (seg === "") ok = false;
        else params[p.slice(1)] = decodeURIComponent(seg);
      } else if (p !== seg) ok = false;
    });
    if (ok) return { spec, params };
  }
  return "prefix";
}

/**
 * Create the internal route handler.
 *
 * @param deps - Host callbacks.
 * @returns A handler returning undefined for paths outside the prefix.
 */
export function createEventsRouter(
  deps: EventsRoutesDeps
): (request: Request) => Promise<Response | undefined> {
  return async (request) => {
    const url = new URL(request.url);
    const m = matchEventsRoute(url.pathname, deps.basePath());
    if (m === undefined) return undefined;
    if (m === "prefix")
      return routeError(404, "not_found", "unknown events route");
    const { spec, params } = m;
    const outcome = authorizeRoute(request, spec.auth, deps.auth());
    if (outcome === "disabled")
      return routeError(
        404,
        "not_found",
        "events routes are disabled: no secret configured"
      );
    if (outcome === "unauthorized")
      return routeError(401, "unauthorized", "a valid bearer is required");
    if (!(spec.methods as readonly string[]).includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { allow: spec.methods.join(", ") },
      });
    switch (spec.id) {
      case "tick":
        return handleTick(deps.tick);
      case "health":
        return handleHealth(deps.health);
      case "emit":
        return handleEmit(request, await deps.emit());
      case "admin.decommission": {
        let body: unknown = {};
        const text = await request.text();
        if (text.trim() !== "") {
          try {
            body = JSON.parse(text);
          } catch {
            return routeError(400, "invalid_body", "body must be JSON");
          }
        }
        const parsed = parseDecommissionBody(body);
        if (!parsed.ok) return routeError(400, "invalid_body", parsed.message);
        return json(200, await deps.decommission(parsed.value));
      }
      default:
        return (
          (await handleAdmin(spec.id, request, params, {
            admin: deps.admin,
            streams: deps.streams,
          })) ?? routeError(404, "not_found", "unknown events route")
        );
    }
  };
}
