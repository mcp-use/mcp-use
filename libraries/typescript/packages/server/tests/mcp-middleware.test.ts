import { describe, expect, it, vi } from "vitest";

import {
  composeMiddleware,
  matchesPattern,
  normalizeMcpMiddlewarePattern,
  parseMcpPattern,
  runMcpOperation,
  type McpEventListenerEntry,
  type McpMiddlewareEntry,
  type MiddlewareContext,
} from "../src/middleware/mcp-middleware.js";

function ctx(
  method: string,
  params: Record<string, unknown> = {}
): MiddlewareContext {
  return { method, params, state: new Map() };
}

describe("matchesPattern", () => {
  it("matches wildcard", () => {
    expect(matchesPattern("*", "tools/call")).toBe(true);
    expect(matchesPattern("*", "prompts/list")).toBe(true);
  });

  it("matches prefix wildcards", () => {
    expect(matchesPattern("tools/*", "tools/call")).toBe(true);
    expect(matchesPattern("tools/*", "tools/list")).toBe(true);
    expect(matchesPattern("tools/*", "resources/read")).toBe(false);
  });

  it("matches exact methods", () => {
    expect(matchesPattern("tools/call", "tools/call")).toBe(true);
    expect(matchesPattern("tools/call", "tools/list")).toBe(false);
  });
});

describe("composeMiddleware", () => {
  it("runs middleware in registration order", async () => {
    const log: string[] = [];
    const entries: McpMiddlewareEntry[] = [
      {
        pattern: "*",
        handler: async (mwCtx, next) => {
          log.push(`outer:${mwCtx.method}`);
          const result = await next();
          log.push(`outer-after:${mwCtx.method}`);
          return result;
        },
      },
      {
        pattern: "tools/call",
        handler: async (_mwCtx, next) => {
          log.push("inner");
          return next();
        },
      },
    ];

    await composeMiddleware(
      entries,
      "tools/call",
      async () => "ok"
    )(ctx("tools/call"));
    expect(log).toEqual([
      "outer:tools/call",
      "inner",
      "outer-after:tools/call",
    ]);
  });

  it("rejects double next()", async () => {
    const entries: McpMiddlewareEntry[] = [
      {
        pattern: "*",
        handler: async (_mwCtx, next) => {
          await next();
          return next();
        },
      },
    ];

    await expect(
      composeMiddleware(
        entries,
        "tools/call",
        async () => "ok"
      )(ctx("tools/call"))
    ).rejects.toThrow("next() called multiple times");
  });

  it("skips middleware when no patterns match", async () => {
    const entries: McpMiddlewareEntry[] = [
      {
        pattern: "tools/call",
        handler: async () => "blocked",
      },
    ];

    const result = await composeMiddleware(
      entries,
      "prompts/get",
      async () => "handler"
    )(ctx("prompts/get"));
    expect(result).toBe("handler");
  });
});

describe("runMcpOperation", () => {
  it("invokes before and complete event listeners", async () => {
    const log: string[] = [];
    const events: McpEventListenerEntry[] = [
      {
        pattern: "tools/call",
        phase: "before",
        handler: (mwCtx: Readonly<MiddlewareContext>) => {
          log.push(`before:${mwCtx.method}`);
        },
      },
      {
        pattern: "tools/call",
        phase: "complete",
        handler: (mwCtx, result) => {
          log.push(`complete:${mwCtx.method}:${String(result)}`);
        },
      },
    ];

    const result = await runMcpOperation(
      [],
      events,
      "tools/call",
      ctx("tools/call"),
      async () => "done"
    );
    expect(result).toBe("done");
    expect(log).toEqual(["before:tools/call", "complete:tools/call:done"]);
  });

  it("logs event listener throws without failing the request", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const events: McpEventListenerEntry[] = [
      {
        pattern: "*",
        phase: "before",
        handler: () => {
          throw new Error("observer failed");
        },
      },
    ];

    const result = await runMcpOperation(
      [],
      events,
      "tools/call",
      ctx("tools/call"),
      async () => "ok"
    );
    expect(result).toBe("ok");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("pattern helpers", () => {
  it("normalizes middleware patterns", () => {
    expect(normalizeMcpMiddlewarePattern("mcp:tools/call")).toBe("tools/call");
    expect(normalizeMcpMiddlewarePattern("tools/call")).toBe("tools/call");
  });

  it("parses complete event patterns", () => {
    expect(parseMcpPattern("mcp:tools/call:complete")).toEqual({
      pattern: "tools/call",
      phase: "complete",
    });
    expect(parseMcpPattern("mcp:*")).toEqual({
      pattern: "*",
      phase: "before",
    });
  });
});
