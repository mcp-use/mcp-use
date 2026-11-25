/**
 * `pingTick` and `runWakeLoop` (§12.3.4): the reference implementation of
 * the wake guarantee (D63).
 *
 * @internal
 */

import type { TickReport } from "../types.js";
import type { PingTickOptions, RunWakeLoopOptions } from "./types.js";

/**
 * Call the tick route once and return its report.
 *
 * @param o - Target, bearer and transport.
 * @returns The `TickReport`.
 * @throws Error when the response is not 200.
 */
export async function pingTick(o: PingTickOptions): Promise<TickReport> {
  const f = o.fetch ?? fetch;
  const headers: Record<string, string> = {
    authorization: `Bearer ${o.secret}`,
  };
  if (o.host !== undefined) headers["host"] = o.host;
  const init: RequestInit = { method: "GET", headers };
  if (o.signal !== undefined) init.signal = o.signal;
  const res = await f(o.url, init);
  if (res.status !== 200)
    throw new Error(`events: tick returned HTTP ${res.status}`);
  return (await res.json()) as TickReport;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/**
 * Reference implementation of the wake guarantee for one namespace: ping
 * when `nextWakeAt` is more than `overdueMs` in the past, repeat at once
 * while `remaining > 0`, back off exponentially (capped) on failure.
 *
 * @param o - Admin handle, tick target and backoff.
 */
export async function runWakeLoop(o: RunWakeLoopOptions): Promise<void> {
  const overdue = o.overdueMs ?? 60_000;
  const cap = o.maxBackoffMs ?? 300_000;
  let backoff = 1_000;
  while (!o.signal.aborted) {
    let wait: number;
    try {
      const next = await o.admin.nextWakeAt();
      if (next === null) wait = overdue;
      else {
        const late = Date.now() - next.getTime();
        if (late <= overdue) wait = Math.max(1, overdue - late);
        else {
          const ping: PingTickOptions = {
            url: o.tick.url,
            secret: o.tick.secret,
            signal: o.signal,
          };
          if (o.tick.host !== undefined) ping.host = o.tick.host;
          const r = await pingTick(ping);
          o.onLog?.({
            type: "tick",
            attempted: r.attempted,
            expired: r.expired,
            remaining: r.remaining,
            nextWakeAt: r.nextWakeAt,
            ms: 0,
          });
          backoff = 1_000;
          if (r.remaining > 0) continue;
          wait =
            r.nextWakeAt === null
              ? overdue
              : Math.max(1, Date.parse(r.nextWakeAt) + overdue - Date.now());
        }
      }
    } catch {
      if (o.signal.aborted) return;
      wait = backoff;
      backoff = Math.min(backoff * 2, cap);
    }
    await sleep(Math.min(wait, cap), o.signal);
  }
}
