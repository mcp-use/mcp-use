import { describe, expect, it } from "vitest";
import { pingTick, runWakeLoop } from "../../../src/events/admin/wake.js";
import type { EventsAdmin } from "../../../src/events/admin/types.js";

describe("pingTick", () => {
  it("sends the bearer and returns the report", async () => {
    const seen: Array<[string, string | null]> = [];
    const report = await pingTick({
      url: "https://app.example/mcp/_mcp-use/events/tick",
      secret: "s1",
      fetch: async (url, init) => {
        seen.push([
          String(url),
          new Headers(init?.headers).get("authorization"),
        ]);
        return new Response(
          JSON.stringify({
            attempted: 2,
            expired: 0,
            remaining: 0,
            nextWakeAt: null,
          })
        );
      },
    });
    expect(report).toEqual({
      attempted: 2,
      expired: 0,
      remaining: 0,
      nextWakeAt: null,
    });
    expect(seen).toEqual([
      ["https://app.example/mcp/_mcp-use/events/tick", "Bearer s1"],
    ]);
  });

  it("throws on a non-200 answer", async () => {
    await expect(
      pingTick({
        url: "https://a/t",
        secret: "s",
        fetch: async () => new Response("{}", { status: 503 }),
      })
    ).rejects.toThrow("HTTP 503");
  });
});

describe("runWakeLoop", () => {
  function admin(next: () => Date | null): EventsAdmin {
    return { nextWakeAt: async () => next() } as EventsAdmin;
  }

  it("pings when overdue and repeats while remaining > 0", async () => {
    const ac = new AbortController();
    let pings = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      pings++;
      const remaining = pings < 3 ? 1 : 0;
      if (pings === 3) ac.abort();
      return new Response(
        JSON.stringify({
          attempted: 1,
          expired: 0,
          remaining,
          nextWakeAt: null,
        })
      );
    }) as typeof fetch;
    try {
      await runWakeLoop({
        admin: admin(() => new Date(Date.now() - 120_000)),
        tick: { url: "https://a/t", secret: "s" },
        signal: ac.signal,
      });
    } finally {
      globalThis.fetch = orig;
    }
    expect(pings).toBe(3);
  });

  it("never pings when nothing is due", async () => {
    const ac = new AbortController();
    let pings = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      pings++;
      return new Response("{}");
    }) as typeof fetch;
    setTimeout(() => ac.abort(), 20);
    try {
      await runWakeLoop({
        admin: admin(() => null),
        tick: { url: "https://a/t", secret: "s" },
        signal: ac.signal,
      });
    } finally {
      globalThis.fetch = orig;
    }
    expect(pings).toBe(0);
  });
});
