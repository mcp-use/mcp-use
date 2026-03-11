/**
 * Tests for AsyncLocalStorage-based request context propagation.
 *
 * Verifies that runWithContext properly stores the Hono Context so that
 * getRequestContext / getSessionId can retrieve it inside async callbacks
 * (e.g. transport.handleRequest within mountMcp).
 *
 * See: https://github.com/mcp-use/mcp-use/issues/1183
 */

import { describe, it, expect } from "vitest";
import {
  runWithContext,
  getRequestContext,
  getSessionId,
  hasRequestContext,
} from "../../../src/server/context-storage.js";
import type { Context } from "hono";

/** Minimal stub that satisfies the Context type for testing purposes. */
function fakeContext(overrides: Record<string, unknown> = {}): Context {
  return { fake: true, ...overrides } as unknown as Context;
}

describe("context-storage", () => {
  it("getRequestContext returns undefined outside runWithContext", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(hasRequestContext()).toBe(false);
  });

  it("runWithContext makes context available via getRequestContext", async () => {
    const ctx = fakeContext({ id: "test-1" });

    await runWithContext(ctx, async () => {
      const retrieved = getRequestContext();
      expect(retrieved).toBe(ctx);
      expect(hasRequestContext()).toBe(true);
    });
  });

  it("runWithContext makes sessionId available via getSessionId", async () => {
    const ctx = fakeContext();

    await runWithContext(
      ctx,
      async () => {
        expect(getSessionId()).toBe("sess-42");
      },
      "sess-42"
    );
  });

  it("context is isolated between concurrent runWithContext calls", async () => {
    const ctx1 = fakeContext({ id: 1 });
    const ctx2 = fakeContext({ id: 2 });

    await Promise.all([
      runWithContext(
        ctx1,
        async () => {
          // Small delay to interleave with the other call
          await new Promise((r) => setTimeout(r, 10));
          expect(getRequestContext()).toBe(ctx1);
          expect(getSessionId()).toBe("a");
        },
        "a"
      ),
      runWithContext(
        ctx2,
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          expect(getRequestContext()).toBe(ctx2);
          expect(getSessionId()).toBe("b");
        },
        "b"
      ),
    ]);
  });

  it("context is cleaned up after runWithContext completes", async () => {
    const ctx = fakeContext();

    await runWithContext(ctx, async () => {
      expect(hasRequestContext()).toBe(true);
    });

    expect(hasRequestContext()).toBe(false);
    expect(getRequestContext()).toBeUndefined();
  });
});
