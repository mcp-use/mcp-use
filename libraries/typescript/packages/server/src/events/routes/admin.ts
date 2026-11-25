/**
 * `admin/*` routes (§12.3.2): thin wrappers over the admin library that
 * return byte-identical JSON (`JSON.stringify` of the library result).
 *
 * @internal
 */

import type { EventsAdmin } from "../admin/types.js";
import type { DeliveryMode, StreamView } from "../types.js";
import type { RevokeRouteRequest } from "./contract.js";
import { routeError } from "./emit.js";
import { json } from "./tick.js";

/** What the admin routes need. */
export interface AdminRouteDeps {
  admin: () => Promise<EventsAdmin>;
  /** Streams open on this instance (principal hashed). */
  streams: () => Promise<StreamView[]>;
}

function opt(u: URL, name: string): string | undefined {
  const v = u.searchParams.get(name);
  return v === null || v === "" ? undefined : v;
}

function limit(u: URL): number | undefined {
  const v = opt(u, "limit");
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

function clean<T extends Record<string, unknown>>(o: T): Defined<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
  return out as Defined<T>;
}

function fail(err: unknown): Response {
  const e = err as {
    code?: string;
    message?: string;
    data?: { notFound?: boolean };
  };
  if (e.data?.notFound === true)
    return routeError(404, "not_found", e.message ?? "not found");
  return routeError(
    400,
    e.code ?? "admin_failed",
    e.message ?? "admin call failed"
  );
}

/**
 * Dispatch an admin route.
 *
 * @param id - Route id from the route table.
 * @param request - The request.
 * @param params - Path parameters.
 * @param deps - Admin handle and streams.
 */
export async function handleAdmin(
  id: string,
  request: Request,
  params: Record<string, string>,
  deps: AdminRouteDeps
): Promise<Response | undefined> {
  const u = new URL(request.url);
  try {
    switch (id) {
      case "admin.subscriptions": {
        const a = await deps.admin();
        return json(
          200,
          await a.subscriptions(
            clean({
              name: opt(u, "name"),
              principal: opt(u, "principal"),
              status: opt(u, "status") as "active" | "suspended" | undefined,
              mode: opt(u, "mode") as DeliveryMode | undefined,
              after: opt(u, "after"),
              limit: limit(u),
            })
          )
        );
      }
      case "admin.subscription": {
        const r = await (await deps.admin()).subscription(params["id"] ?? "");
        return r === null
          ? routeError(404, "not_found", "subscription not found")
          : json(200, r);
      }
      case "admin.leases":
        return json(
          200,
          await (
            await deps.admin()
          ).leases(
            clean({
              name: opt(u, "name"),
              principal: opt(u, "principal"),
              after: opt(u, "after"),
              limit: limit(u),
            })
          )
        );
      case "admin.dead-letters":
        return json(
          200,
          await (
            await deps.admin()
          ).deadLetters(
            clean({
              subscriptionId: opt(u, "subscriptionId"),
              after: opt(u, "after"),
              limit: limit(u),
            })
          )
        );
      case "admin.redeliver":
        return json(
          200,
          await (await deps.admin()).redeliver(params["id"] ?? "")
        );
      case "admin.revoke": {
        let body: RevokeRouteRequest;
        try {
          body = (await request.json()) as RevokeRouteRequest;
        } catch {
          return routeError(400, "invalid_body", "body must be JSON");
        }
        if (
          body === null ||
          typeof body !== "object" ||
          (body.principal === undefined && body.subscriptionId === undefined)
        )
          return routeError(
            400,
            "invalid_body",
            "principal or subscriptionId is required"
          );
        return json(200, await (await deps.admin()).revoke(clean({ ...body })));
      }
      case "admin.streams":
        return json(200, await deps.streams());
      default:
        return undefined;
    }
  } catch (err) {
    return fail(err);
  }
}
