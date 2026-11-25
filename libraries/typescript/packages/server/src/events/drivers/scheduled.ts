/**
 * Workers `scheduled` driver (D19): one tick kept alive by `ctx.waitUntil`.
 *
 * @internal
 */

import type { TickReport } from "../types.js";

/**
 * Run a tick from a cron trigger.
 *
 * @param tick - The tick function.
 * @param ctx - Workers execution context.
 */
export async function runScheduled(
  tick: () => Promise<TickReport>,
  ctx: { waitUntil(p: Promise<unknown>): void }
): Promise<void> {
  const p = tick();
  ctx.waitUntil(p.catch(() => undefined));
  await p;
}
