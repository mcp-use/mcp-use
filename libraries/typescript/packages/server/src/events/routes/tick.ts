/**
 * `GET | POST tick` (§12.3.2): one tick; `503 {state:"degraded"}` when the
 * store is unreachable.
 *
 * @internal
 */

import type { TickReport } from "../types.js";
import type { DegradedResponse } from "./contract.js";

/** JSON response helper shared by the routes. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

/**
 * Handle the tick route.
 *
 * @param tick - Runs one tick.
 */
export async function handleTick(
  tick: () => Promise<TickReport>
): Promise<Response> {
  try {
    return json(200, await tick());
  } catch {
    const body: DegradedResponse = { state: "degraded" };
    return json(503, body);
  }
}
