import { describe, expect, it, vi, afterEach } from "vitest";
import type { MiddlewareContext } from "../../../src/server/middleware/mcp-middleware.js";
import {
  DEFAULT_IDEMPOTENCY_STATE_KEY,
  DEFAULT_TIMEOUT_SIGNAL_STATE_KEY,
  TimeoutPolicyError,
  createIdempotencyKeyMiddleware,
  createTimeoutPolicyMiddleware,
  getIdempotencyKey,
} from "../../../src/server/middleware/production.js";

function makeCtx(
  params: Record<string, unknown> = { name: "delete_order" }
): MiddlewareContext {
  return {
    method: "tools/call",
    params,
    state: new Map(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createTimeoutPolicyMiddleware", () => {
  it("passes through results that finish before the timeout", async () => {
    const middleware = createTimeoutPolicyMiddleware({ timeoutMs: 50 });
    const ctx = makeCtx();

    const result = await middleware(ctx, async () => "ok");

    expect(result).toBe("ok");
    expect(ctx.state.get(DEFAULT_TIMEOUT_SIGNAL_STATE_KEY)).toBeInstanceOf(
      AbortSignal
    );
    expect(ctx.state.get("timeoutMs")).toBe(50);
  });

  it("rejects with TimeoutPolicyError after the configured timeout", async () => {
    vi.useFakeTimers();
    const middleware = createTimeoutPolicyMiddleware({ timeoutMs: 10 });
    const ctx = makeCtx();

    const result = middleware(
      ctx,
      () => new Promise((resolve) => setTimeout(resolve, 50))
    );
    const assertion = expect(result).rejects.toBeInstanceOf(TimeoutPolicyError);

    await vi.advanceTimersByTimeAsync(10);

    await assertion;
    expect(
      (ctx.state.get(DEFAULT_TIMEOUT_SIGNAL_STATE_KEY) as AbortSignal).aborted
    ).toBe(true);
  });
});

describe("idempotency key middleware", () => {
  it("extracts keys from tool metadata and stores them in state", async () => {
    const middleware = createIdempotencyKeyMiddleware({
      mutatingTools: ["delete_order"],
    });
    const ctx = makeCtx({
      name: "delete_order",
      arguments: { id: "ord_1" },
      _meta: { idempotencyKey: "key_123" },
    });
    const next = vi.fn().mockResolvedValue("ok");

    const result = await middleware(ctx, next);

    expect(result).toBe("ok");
    expect(next).toHaveBeenCalledOnce();
    expect(ctx.state.get(DEFAULT_IDEMPOTENCY_STATE_KEY)).toBe("key_123");
  });

  it("blocks configured mutating tools without an idempotency key", async () => {
    const middleware = createIdempotencyKeyMiddleware({
      mutatingTools: ["delete_order"],
    });
    const ctx = makeCtx({
      name: "delete_order",
      arguments: { id: "ord_1" },
    });
    const next = vi.fn().mockResolvedValue("should not run");

    const result = await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      isError: true,
      _meta: {
        "mcp-use/idempotency": {
          code: "missing_idempotency_key",
        },
      },
    });
  });

  it("reads idempotency keys from request metadata and arguments", () => {
    expect(
      getIdempotencyKey({
        ...makeCtx({ name: "update_order", arguments: {} }),
        requestMeta: { "Idempotency-Key": "meta_key" },
      })
    ).toBe("meta_key");

    expect(
      getIdempotencyKey(
        makeCtx({
          name: "update_order",
          arguments: { idempotency_key: "arg_key" },
        })
      )
    ).toBe("arg_key");
  });
});
