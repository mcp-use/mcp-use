/**
 * Lazy pump for long-lived handler hosts (Express via `mcp-use/node`,
 * TanStack Start, `Bun.serve`, `Deno.serve`; D19): started on first use,
 * `unref()`'d, never started under a serverless marker or `worker: "off"`.
 *
 * @internal
 */

import { startPump, type Pump, type PumpOptions } from "./pump.js";

/** Lazy pump controller. */
export interface LazyPump {
  /** Start on first call (no-op when disabled); kicks an already running pump. */
  touch(): void;
  /** The pump, once started. */
  readonly pump: Pump | undefined;
  /** Stop when started. */
  stop(): Promise<void>;
}

/**
 * Create a lazy pump.
 *
 * @param o - Pump options; `unref` is forced on.
 * @param enabled - False under a serverless marker or `worker: "off"`.
 */
export function createLazyPump(o: PumpOptions, enabled: boolean): LazyPump {
  let pump: Pump | undefined;
  return {
    touch() {
      if (!enabled) return;
      if (pump === undefined) pump = startPump({ ...o, unref: true });
      else pump.kick();
    },
    get pump() {
      return pump;
    },
    async stop() {
      await pump?.stop();
    },
  };
}
