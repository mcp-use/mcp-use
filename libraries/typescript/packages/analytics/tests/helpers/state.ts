import { shutdown } from "../../src/index.js";
import { monotonicNow } from "../../src/runtime.js";
import { globalState } from "../../src/state.js";

/** A clock that moves only when told to. */
export interface FakeClock {
  /** Move the clock forward. */
  advance(ms: number): void;
}

/**
 * Replace the clock that ages the dashboard settings of every analytics
 * client created so far, so a test can age them without waiting a minute. It
 * starts at the real time, so settings fetched before keep their age.
 */
export function fakeConfigClock(): FakeClock {
  let now = monotonicNow();
  const clock = () => now;
  for (const client of globalState().clients.values()) client.clock = clock;
  return {
    advance: (ms) => {
      now += ms;
    },
  };
}

/** Stop every client and forget all process-wide analytics state. */
export async function resetAnalytics(): Promise<void> {
  await shutdown();
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("@mcp-use/analytics.state")
  ];
}

/** Events for one method, in arrival order. */
export function byMethod<T extends { method: string }>(
  events: T[],
  method: string
): T[] {
  return events.filter((event) => event.method === method);
}

/** The single event matching a predicate; fails when there is not exactly one. */
export function only<T>(events: T[], predicate: (event: T) => boolean): T {
  const matches = events.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one matching event, got ${matches.length}: ${JSON.stringify(events, null, 2)}`
    );
  }
  return matches[0]!;
}
