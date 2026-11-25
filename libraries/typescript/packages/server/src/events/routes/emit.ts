/**
 * `POST emit` (D38): test emits. Outside dev `x-mcp-use-confirm` must equal
 * the namespace or its hash (400 otherwise). Ids get the `test_` prefix.
 *
 * @internal
 */

import type { EmitResult } from "../types.js";
import { CONFIRM_HEADER, type EmitRouteRequest } from "./contract.js";
import { json } from "./tick.js";

/** What the emit route needs. */
export interface EmitRouteDeps {
  namespace: string;
  nsHash: string;
  /** True under the dev runtime (no confirm header needed). */
  dev: boolean;
  /** Emit a test event (`test: true` entries). */
  emit(req: EmitRouteRequest & { eventId: string }): Promise<EmitResult>;
}

/** Route error body. */
export function routeError(
  status: number,
  code: string,
  message: string,
  data?: Record<string, unknown>
): Response {
  return json(status, {
    error: data === undefined ? { code, message } : { code, message, data },
  });
}

/** Prefix an id with `test_` once. */
export function testEventId(id: string | undefined): string {
  const raw = id ?? crypto.randomUUID();
  return raw.startsWith("test_") ? raw : `test_${raw}`;
}

/**
 * Handle the emit route.
 *
 * @param request - The request.
 * @param deps - Namespace and emitter.
 */
export async function handleEmit(
  request: Request,
  deps: EmitRouteDeps
): Promise<Response> {
  if (!deps.dev) {
    const c = request.headers.get(CONFIRM_HEADER);
    if (c !== deps.namespace && c !== deps.nsHash)
      return routeError(
        400,
        "confirm_required",
        `${CONFIRM_HEADER} must be the namespace or its hash`
      );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return routeError(400, "invalid_body", "body must be JSON");
  }
  const b = body as Partial<EmitRouteRequest> | null;
  if (
    b === null ||
    typeof b !== "object" ||
    typeof b.name !== "string" ||
    !("data" in b)
  )
    return routeError(400, "invalid_body", "body must be {name, data}");
  const req: EmitRouteRequest & { eventId: string } = {
    name: b.name,
    data: b.data,
    eventId: testEventId(typeof b.eventId === "string" ? b.eventId : undefined),
  };
  if (typeof b.principal === "string") req.principal = b.principal;
  if (typeof b.subscriptionId === "string")
    req.subscriptionId = b.subscriptionId;
  try {
    return json(200, await deps.emit(req));
  } catch (err) {
    const e = err as {
      code?: string;
      message?: string;
      data?: Record<string, unknown>;
    };
    return routeError(
      400,
      e.code ?? "emit_failed",
      e.message ?? "emit failed",
      e.data
    );
  }
}
