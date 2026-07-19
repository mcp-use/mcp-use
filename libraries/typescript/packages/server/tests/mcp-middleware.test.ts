import { describe, expect, it, vi } from "vitest";

import {
  composeMiddleware,
  createMcpMiddlewareEntry,
  matchesPattern,
  normalizeMcpMiddlewarePattern,
  parseMcpPattern,
  runMcpOperation,
  withMcpMiddlewareParams,
  type McpEventListenerEntry,
  type McpMiddlewareEntry,
  type McpMiddlewareMethod,
  type McpMiddlewarePattern,
  type MiddlewareContext,
} from "../src/middleware/mcp-middleware.js";

function ctx<M extends McpMiddlewareMethod>(
  method: M,
  params: MiddlewareContext<M>["params"] = {} as MiddlewareContext<M>["params"]
): MiddlewareContext<M> {
  return { method, params, state: new Map() } as MiddlewareContext<M>;
}

const toolResult = {
  content: [{ type: "text" as const, text: "ok" }],
};

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
      createMcpMiddlewareEntry("mcp:*", async (mwCtx, next) => {
        log.push(`outer:${mwCtx.method}`);
        await next();
        log.push(`outer-after:${mwCtx.method}`);
      }),
      createMcpMiddlewareEntry("mcp:tools/call", async (_mwCtx, next) => {
        log.push("inner");
        return next();
      }),
    ];

    await composeMiddleware(
      entries,
      "tools/call",
      async () => toolResult
    )(ctx("tools/call"));
    expect(log).toEqual([
      "outer:tools/call",
      "inner",
      "outer-after:tools/call",
    ]);
  });

  it("rejects double next()", async () => {
    const entries: McpMiddlewareEntry[] = [
      createMcpMiddlewareEntry("mcp:*", async (_mwCtx, next) => {
        await next();
        return next();
      }),
    ];

    await expect(
      composeMiddleware(
        entries,
        "tools/call",
        async () => toolResult
      )(ctx("tools/call"))
    ).rejects.toThrow("next() called multiple times");
  });

  it("requires wildcard middleware to preserve the downstream result", async () => {
    const entries: McpMiddlewareEntry[] = [
      createMcpMiddlewareEntry("mcp:*", async () => undefined),
    ];

    await expect(
      composeMiddleware(
        entries,
        "tools/call",
        async () => toolResult
      )(ctx("tools/call"))
    ).rejects.toThrow('Wildcard MCP middleware "*" must call next()');
  });

  it("skips middleware when no patterns match", async () => {
    const entries: McpMiddlewareEntry[] = [
      createMcpMiddlewareEntry("mcp:tools/call", async () => toolResult),
    ];

    const result = await composeMiddleware(
      entries,
      "prompts/get",
      async () => ({ messages: [] })
    )(ctx("prompts/get"));
    expect(result).toEqual({ messages: [] });
  });
});

describe("runMcpOperation", () => {
  it("invokes before and complete event listeners", async () => {
    const log: string[] = [];
    const events: McpEventListenerEntry[] = [
      {
        pattern: "tools/call",
        phase: "before",
        handler: (mwCtx) => {
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
      async () => toolResult
    );
    expect(result).toBe(toolResult);
    expect(log).toEqual([
      "before:tools/call",
      "complete:tools/call:[object Object]",
    ]);
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
      async () => toolResult
    );
    expect(result).toBe(toolResult);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("pattern helpers", () => {
  it("forwards the current middleware params in the downstream request", () => {
    const originalRequest = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/list" as const,
      params: { cursor: "original" },
    };
    const replacement = { cursor: "replacement" };

    const downstreamRequest = withMcpMiddlewareParams<"tools/list">(
      originalRequest,
      replacement
    );

    expect(downstreamRequest).toEqual({
      ...originalRequest,
      params: replacement,
    });
    expect(downstreamRequest.params).toBe(replacement);
    expect(originalRequest.params.cursor).toBe("original");
  });

  it("rejects category wildcard middleware at runtime", () => {
    expect(() =>
      createMcpMiddlewareEntry(
        "mcp:tools/*" as McpMiddlewarePattern,
        async () => undefined
      )
    ).toThrow('Use an exact MCP method or "mcp:*"');
  });

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
