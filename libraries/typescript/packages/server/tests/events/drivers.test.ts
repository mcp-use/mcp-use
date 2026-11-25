import { describe, expect, it } from "vitest";
import { startPump } from "../../src/events/drivers/pump.js";
import { createLazyPump } from "../../src/events/drivers/lazy-pump.js";
import { runTick } from "../../src/events/drivers/tick.js";
import { executionCtxWaitUntil } from "../../src/events/drivers/wait-until.js";

const report = (remaining: number) => ({
  attempted: 1,
  expired: 0,
  remaining,
  nextWakeAt: null,
});

describe("drivers (D19)", () => {
  it("pump repeats at once while remaining > 0, then idles", async () => {
    let runs = 0;
    const pump = startPump({
      work: async () => report(++runs < 3 ? 1 : 0),
      scanMs: 10_000,
      idleMs: 10_000,
    });
    await new Promise((r) => setTimeout(r, 30));
    await pump.stop();
    expect(runs).toBe(3);
  });

  it("lazy pump never starts when disabled", async () => {
    let runs = 0;
    const lazy = createLazyPump(
      {
        work: async () => {
          runs++;
          return report(0);
        },
      },
      false
    );
    lazy.touch();
    await new Promise((r) => setTimeout(r, 10));
    expect([runs, lazy.pump]).toEqual([0, undefined]);
  });

  it("tick adds the sweep and counts", async () => {
    const counters = { count: 0, last: null as string | null };
    const r = await runTick(
      { process: async () => report(0), sweep: async () => ({ expired: 4 }) },
      counters
    );
    expect([r.expired, counters.count]).toEqual([4, 1]);
  });

  it("reads executionCtx safely when the getter throws", () => {
    const c = Object.defineProperty({}, "executionCtx", {
      get() {
        throw new Error("no ctx");
      },
    });
    expect(executionCtxWaitUntil(c)).toBeUndefined();
  });
});
