import { describe, it, expect, vi } from "vitest";
import {
  matchesPattern,
  composeMiddleware,
  type MiddlewareContext,
  type McpMiddlewareEntry,
} from "../../../src/server/middleware/mcp-middleware.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(method = "tools/call"): MiddlewareContext {
  return {
    method,
    params: {},
    state: new Map(),
  };
}

function makeEntry(
  pattern: string,
  handler: McpMiddlewareEntry["handler"]
): McpMiddlewareEntry {
  return { pattern, handler };
}

// ---------------------------------------------------------------------------
// matchesPattern
// ---------------------------------------------------------------------------

describe("matchesPattern", () => {
  it("exact match returns true", () => {
    expect(matchesPattern("tools/call", "tools/call")).toBe(true);
  });

  it("exact match returns false for different method", () => {
    expect(matchesPattern("tools/call", "tools/list")).toBe(false);
  });

  it("'*' matches any method", () => {
    expect(matchesPattern("*", "tools/call")).toBe(true);
    expect(matchesPattern("*", "resources/read")).toBe(true);
    expect(matchesPattern("*", "anything")).toBe(true);
  });

  it("prefix wildcard 'tools/*' matches tool methods", () => {
    expect(matchesPattern("tools/*", "tools/call")).toBe(true);
    expect(matchesPattern("tools/*", "tools/list")).toBe(true);
  });

  it("prefix wildcard 'tools/*' does not match other namespaces", () => {
    expect(matchesPattern("tools/*", "resources/read")).toBe(false);
    expect(matchesPattern("tools/*", "prompts/get")).toBe(false);
  });

  it("prefix wildcard 'resources/*' matches resource methods", () => {
    expect(matchesPattern("resources/*", "resources/read")).toBe(true);
    expect(matchesPattern("resources/*", "resources/list")).toBe(true);
  });

  it("prefix wildcard does not match exact prefix without slash", () => {
    expect(matchesPattern("tools/*", "toolsother")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// composeMiddleware — no middleware
// ---------------------------------------------------------------------------

describe("composeMiddleware with no entries", () => {
  it("calls innerFn directly when no middleware matches", async () => {
    const inner = vi.fn().mockResolvedValue("inner-result");
    const composed = composeMiddleware([], "tools/call", inner);
    const result = await composed(makeCtx("tools/call"));
    expect(inner).toHaveBeenCalledOnce();
    expect(result).toBe("inner-result");
  });

  it("calls innerFn when no entry matches the method", async () => {
    const inner = vi.fn().mockResolvedValue("inner-result");
    const entries = [makeEntry("resources/read", async (_ctx, next) => next())];
    const composed = composeMiddleware(entries, "tools/call", inner);
    const result = await composed(makeCtx("tools/call"));
    expect(inner).toHaveBeenCalledOnce();
    expect(result).toBe("inner-result");
  });
});

// ---------------------------------------------------------------------------
// composeMiddleware — execution order
// ---------------------------------------------------------------------------

describe("composeMiddleware execution order", () => {
  it("executes middleware in FIFO order", async () => {
    const order: string[] = [];

    const a = makeEntry("tools/call", async (_ctx, next) => {
      order.push("a-before");
      const r = await next();
      order.push("a-after");
      return r;
    });
    const b = makeEntry("tools/call", async (_ctx, next) => {
      order.push("b-before");
      const r = await next();
      order.push("b-after");
      return r;
    });

    const inner = async () => {
      order.push("inner");
      return "result";
    };

    const composed = composeMiddleware([a, b], "tools/call", inner);
    await composed(makeCtx());

    expect(order).toEqual([
      "a-before",
      "b-before",
      "inner",
      "b-after",
      "a-after",
    ]);
  });

  it("wildcard middleware runs alongside specific middleware", async () => {
    const order: string[] = [];

    const catchAll = makeEntry("*", async (_ctx, next) => {
      order.push("wildcard");
      return next();
    });
    const specific = makeEntry("tools/call", async (_ctx, next) => {
      order.push("specific");
      return next();
    });

    const inner = async () => {
      order.push("inner");
      return "ok";
    };

    const composed = composeMiddleware(
      [catchAll, specific],
      "tools/call",
      inner
    );
    await composed(makeCtx());

    expect(order).toEqual(["wildcard", "specific", "inner"]);
  });

  it("only matching middleware runs", async () => {
    const called: string[] = [];

    const entries = [
      makeEntry("tools/*", async (_ctx, next) => {
        called.push("tools/*");
        return next();
      }),
      makeEntry("resources/read", async (_ctx, next) => {
        called.push("resources/read");
        return next();
      }),
    ];

    const composed = composeMiddleware(entries, "tools/call", async () => "ok");
    await composed(makeCtx("tools/call"));

    expect(called).toEqual(["tools/*"]);
  });
});

// ---------------------------------------------------------------------------
// composeMiddleware — short-circuit
// ---------------------------------------------------------------------------

describe("composeMiddleware short-circuit", () => {
  it("middleware can short-circuit by not calling next()", async () => {
    const inner = vi.fn().mockResolvedValue("inner");
    const mw = makeEntry("tools/call", async (_ctx, _next) => {
      return "short-circuit";
    });

    const composed = composeMiddleware([mw], "tools/call", inner);
    const result = await composed(makeCtx());

    expect(result).toBe("short-circuit");
    expect(inner).not.toHaveBeenCalled();
  });

  it("middleware can override result by returning different value from next()", async () => {
    const inner = vi.fn().mockResolvedValue("original");
    const mw = makeEntry("tools/call", async (_ctx, next) => {
      const r = await next();
      return `modified:${r}`;
    });

    const composed = composeMiddleware([mw], "tools/call", inner);
    const result = await composed(makeCtx());

    expect(result).toBe("modified:original");
    expect(inner).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// composeMiddleware — error propagation
// ---------------------------------------------------------------------------

describe("composeMiddleware error propagation", () => {
  it("error thrown in middleware bubbles up", async () => {
    const inner = vi.fn().mockResolvedValue("ok");
    const mw = makeEntry("tools/call", async (_ctx, _next) => {
      throw new Error("middleware-error");
    });

    const composed = composeMiddleware([mw], "tools/call", inner);
    await expect(composed(makeCtx())).rejects.toThrow("middleware-error");
    expect(inner).not.toHaveBeenCalled();
  });

  it("error thrown in innerFn propagates through middleware", async () => {
    const inner = async () => {
      throw new Error("inner-error");
    };
    const mw = makeEntry("tools/call", async (_ctx, next) => {
      return next(); // does not catch
    });

    const composed = composeMiddleware([mw], "tools/call", inner);
    await expect(composed(makeCtx())).rejects.toThrow("inner-error");
  });

  it("middleware can catch and re-throw errors", async () => {
    const caught: string[] = [];
    const mw = makeEntry("tools/call", async (_ctx, next) => {
      try {
        return await next();
      } catch (err: any) {
        caught.push(err.message);
        throw err;
      }
    });

    const inner = async () => {
      throw new Error("inner-error");
    };

    const composed = composeMiddleware([mw], "tools/call", inner);
    await expect(composed(makeCtx())).rejects.toThrow("inner-error");
    expect(caught).toEqual(["inner-error"]);
  });
});

// ---------------------------------------------------------------------------
// composeMiddleware — context & state passing
// ---------------------------------------------------------------------------

describe("composeMiddleware context and state", () => {
  it("ctx.state is shared across all middleware in the chain", async () => {
    const mwA = makeEntry("tools/call", async (ctx, next) => {
      ctx.state.set("key", "value-from-a");
      return next();
    });
    const mwB = makeEntry("tools/call", async (ctx, next) => {
      ctx.state.set("key2", ctx.state.get("key") + "-read-by-b");
      return next();
    });

    let stateInInner: Map<string, unknown> | undefined;
    const inner = async (/* ctx not passed but we close over it */) => {
      return "ok";
    };

    // Override: let the inner function access ctx
    const mwC = makeEntry("tools/call", async (ctx, next) => {
      stateInInner = new Map(ctx.state);
      return next();
    });

    const composed = composeMiddleware([mwA, mwB, mwC], "tools/call", inner);
    await composed(makeCtx());

    expect(stateInInner?.get("key")).toBe("value-from-a");
    expect(stateInInner?.get("key2")).toBe("value-from-a-read-by-b");
  });

  it("middleware can mutate ctx.params and downstream sees changes", async () => {
    const mw = makeEntry("tools/call", async (ctx, next) => {
      ctx.params = { ...ctx.params, injected: true };
      return next();
    });

    let receivedParams: Record<string, unknown> | undefined;
    const inner = async () => {
      return "ok";
    };

    const capture = makeEntry("tools/call", async (ctx, next) => {
      receivedParams = ctx.params;
      return next();
    });

    const composed = composeMiddleware([mw, capture], "tools/call", inner);
    await composed(makeCtx());

    expect(receivedParams?.injected).toBe(true);
  });

  it("ctx fields are correctly set", async () => {
    const ctx: MiddlewareContext = {
      method: "tools/call",
      params: { name: "my-tool" },
      session: { sessionId: "sess-1" },
      auth: {
        user: { sub: "user-1" },
        payload: {},
        accessToken: "token",
        scopes: ["tools:call"],
        permissions: [],
      } as any,
      state: new Map(),
    };

    let capturedCtx: MiddlewareContext | undefined;
    const mw = makeEntry("tools/call", async (c, next) => {
      capturedCtx = c;
      return next();
    });

    const composed = composeMiddleware([mw], "tools/call", async () => "ok");
    await composed(ctx);

    expect(capturedCtx?.method).toBe("tools/call");
    expect(capturedCtx?.params).toEqual({ name: "my-tool" });
    expect(capturedCtx?.session?.sessionId).toBe("sess-1");
    expect(capturedCtx?.auth?.scopes).toContain("tools:call");
  });
});

// ---------------------------------------------------------------------------
// composeMiddleware — next() called multiple times guard
// ---------------------------------------------------------------------------

describe("composeMiddleware next() guard", () => {
  it("throws if next() is called twice in the same middleware", async () => {
    const mw = makeEntry("tools/call", async (_ctx, next) => {
      await next();
      return next(); // second call should throw
    });

    const composed = composeMiddleware([mw], "tools/call", async () => "ok");
    await expect(composed(makeCtx())).rejects.toThrow(
      "next() called multiple times"
    );
  });
});
