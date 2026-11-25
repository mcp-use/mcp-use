/**
 * The pump (PLAN.md D19): per-process timer that runs due work, rescans
 * every 30 s (60 s when idle) and wakes early on `nextWakeAt`. Many
 * instances are safe because claims are CAS leases.
 *
 * @internal
 */

import type { TickReport } from "../types.js";

/** Pump options. */
export interface PumpOptions {
  /** One pass of due work (process + dispatch + sweep when leader). */
  work: () => Promise<TickReport>;
  /** Busy scan interval; default 30 000. */
  scanMs?: number;
  /** Idle scan interval; default 60 000. */
  idleMs?: number;
  /** `unref()` timers so the process can exit (handler hosts). */
  unref?: boolean;
  /** Clock; default `Date.now`. */
  now?: () => number;
  /** Errors from `work` (the pump keeps running). */
  onError?: (err: unknown) => void;
}

/** A running pump. */
export interface Pump {
  /** Run a pass soon (after an emit or wake signal). */
  kick(): void;
  /** Stop timers and wait for the running pass. */
  stop(): Promise<void>;
  /** Whether a pass is running. */
  readonly running: boolean;
}

/**
 * Start a pump.
 *
 * @param o - Work function and intervals.
 */
export function startPump(o: PumpOptions): Pump {
  const scan = o.scanMs ?? 30_000;
  const idle = o.idleMs ?? 60_000;
  const now = o.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Promise<void> | undefined;
  let stopped = false;
  let again = false;

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, Math.max(0, ms));
    const t = timer as { unref?: () => void };
    if (o.unref === true) t.unref?.();
  };

  function run(): void {
    timer = undefined;
    if (current !== undefined) {
      again = true;
      return;
    }
    current = (async () => {
      let delay = idle;
      try {
        const r = await o.work();
        if (r.remaining > 0) delay = 0;
        else {
          delay = r.attempted > 0 ? scan : idle;
          if (r.nextWakeAt !== null) {
            const until = Date.parse(r.nextWakeAt) - now();
            if (until < delay) delay = Math.max(0, until);
          }
        }
      } catch (err) {
        o.onError?.(err);
        delay = scan;
      } finally {
        current = undefined;
      }
      if (again) {
        again = false;
        delay = 0;
      }
      schedule(delay);
    })();
  }

  schedule(0);
  return {
    kick() {
      if (current !== undefined) again = true;
      else schedule(0);
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      await current;
    },
    get running() {
      return current !== undefined;
    },
  };
}
