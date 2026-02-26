import { describe, it, expect } from "vitest";
import {
  buildListToolsChain,
  buildCallToolChain,
  buildListPromptsChain,
  buildListResourcesChain,
} from "../../../src/server/middleware/hooks.js";
import type {
  Middleware,
  MiddlewareContext,
  ToolInfo,
  PromptInfo,
  ResourceInfo,
  CallToolResultLike,
} from "../../../src/server/types/middleware.js";

const baseCtx: MiddlewareContext = {
  server: { name: "test-server", version: "1.0.0" },
};

// ---------------------------------------------------------------------------
// buildListToolsChain
// ---------------------------------------------------------------------------
describe("buildListToolsChain", () => {
  const sampleTools: ToolInfo[] = [
    { name: "tool-a", inputSchema: {} },
    { name: "tool-b", inputSchema: {} },
    { name: "admin-delete", inputSchema: {} },
  ];

  it("passes through base result when no middlewares are registered", async () => {
    const baseFn = async () => sampleTools;
    const chain = buildListToolsChain([], baseFn);
    const result = await chain(baseCtx);
    expect(result).toEqual(sampleTools);
  });

  it("single middleware can filter tools", async () => {
    const baseFn = async () => sampleTools;
    const mw: Middleware = {
      name: "filter",
      onListTools: async (_ctx, callNext) => {
        const tools = await callNext();
        return tools.filter((t) => !t.name.startsWith("admin-"));
      },
    };
    const chain = buildListToolsChain([mw], baseFn);
    const result = await chain(baseCtx);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["tool-a", "tool-b"]);
  });

  it("multiple middlewares chain in registration order (first = outermost)", async () => {
    const order: string[] = [];
    const baseFn = async () => {
      order.push("base");
      return sampleTools;
    };
    const mw1: Middleware = {
      name: "first",
      onListTools: async (_ctx, callNext) => {
        order.push("first-before");
        const tools = await callNext();
        order.push("first-after");
        return tools;
      },
    };
    const mw2: Middleware = {
      name: "second",
      onListTools: async (_ctx, callNext) => {
        order.push("second-before");
        const tools = await callNext();
        order.push("second-after");
        return tools;
      },
    };
    const chain = buildListToolsChain([mw1, mw2], baseFn);
    await chain(baseCtx);
    expect(order).toEqual([
      "first-before",
      "second-before",
      "base",
      "second-after",
      "first-after",
    ]);
  });

  it("context carries auth info", async () => {
    const baseFn = async () => sampleTools;
    let capturedAuth: unknown;
    const mw: Middleware = {
      onListTools: async (ctx, callNext) => {
        capturedAuth = ctx.auth;
        return callNext();
      },
    };
    const ctxWithAuth: MiddlewareContext = {
      ...baseCtx,
      auth: {
        user: { userId: "user-1", name: "Test" },
        payload: {},
        accessToken: "tok",
        scopes: [],
        permissions: [],
      },
    };
    const chain = buildListToolsChain([mw], baseFn);
    await chain(ctxWithAuth);
    expect(capturedAuth).toBeDefined();
    expect((capturedAuth as any).user.userId).toBe("user-1");
  });

  it("skips middlewares without onListTools", async () => {
    const baseFn = async () => sampleTools;
    const noopMw: Middleware = { name: "noop" };
    const filterMw: Middleware = {
      onListTools: async (_ctx, callNext) => {
        const tools = await callNext();
        return tools.filter((t) => t.name === "tool-a");
      },
    };
    const chain = buildListToolsChain([noopMw, filterMw], baseFn);
    const result = await chain(baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("tool-a");
  });
});

// ---------------------------------------------------------------------------
// buildCallToolChain
// ---------------------------------------------------------------------------
describe("buildCallToolChain", () => {
  const baseResult: CallToolResultLike = {
    content: [{ type: "text", text: "ok" }],
  };

  it("passes through base result when no middlewares are registered", async () => {
    const baseFn = async () => baseResult;
    const chain = buildCallToolChain([]);
    const result = await chain(baseCtx, { name: "tool-a" }, baseFn);
    expect(result).toEqual(baseResult);
  });

  it("middleware can block execution by throwing", async () => {
    const baseFn = async () => baseResult;
    const mw: Middleware = {
      onCallTool: async (_ctx, params, _callNext) => {
        if (params.name === "admin-delete") {
          throw new Error("Unauthorized");
        }
        return _callNext();
      },
    };
    const chain = buildCallToolChain([mw]);
    await expect(
      chain(baseCtx, { name: "admin-delete" }, baseFn)
    ).rejects.toThrow("Unauthorized");
  });

  it("middleware can modify the result", async () => {
    const baseFn = async () => baseResult;
    const mw: Middleware = {
      onCallTool: async (_ctx, _params, callNext) => {
        const result = await callNext();
        return { ...result, isError: false };
      },
    };
    const chain = buildCallToolChain([mw]);
    const result = await chain(baseCtx, { name: "tool-a" }, baseFn);
    expect(result.isError).toBe(false);
  });

  it("receives correct params", async () => {
    let capturedParams:
      | { name: string; arguments?: Record<string, unknown> }
      | undefined;
    const baseFn = async () => baseResult;
    const mw: Middleware = {
      onCallTool: async (_ctx, params, callNext) => {
        capturedParams = params;
        return callNext();
      },
    };
    const chain = buildCallToolChain([mw]);
    await chain(baseCtx, { name: "add", arguments: { a: 1, b: 2 } }, baseFn);
    expect(capturedParams).toEqual({ name: "add", arguments: { a: 1, b: 2 } });
  });

  it("error thrown by baseFn propagates through the chain", async () => {
    const baseFn = async () => {
      throw new Error("tool execution failed");
    };
    const mw: Middleware = {
      onCallTool: async (_ctx, _params, callNext) => callNext(),
    };
    const chain = buildCallToolChain([mw]);
    await expect(
      chain(baseCtx, { name: "tool-a" }, baseFn)
    ).rejects.toThrow("tool execution failed");
  });

  it("hook-filtering runs once — chain built per session, baseFn per request", async () => {
    // The chain function should be reusable across multiple invocations
    // with different baseFns (simulating per-request base handlers).
    const chain = buildCallToolChain([
      {
        onCallTool: async (_ctx, _params, callNext) => {
          const result = await callNext();
          return { ...result, isError: false };
        },
      },
    ]);

    const result1 = await chain(
      baseCtx,
      { name: "t1" },
      async () => ({ content: [{ type: "text", text: "first" }] })
    );
    const result2 = await chain(
      baseCtx,
      { name: "t2" },
      async () => ({ content: [{ type: "text", text: "second" }] })
    );

    expect(result1.content?.[0]).toEqual({ type: "text", text: "first" });
    expect(result2.content?.[0]).toEqual({ type: "text", text: "second" });
  });
});

// ---------------------------------------------------------------------------
// buildListPromptsChain
// ---------------------------------------------------------------------------
describe("buildListPromptsChain", () => {
  const samplePrompts: PromptInfo[] = [
    { name: "prompt-a", description: "A" },
    { name: "prompt-b", description: "B" },
  ];

  it("passes through base result when no middlewares are registered", async () => {
    const baseFn = async () => samplePrompts;
    const chain = buildListPromptsChain([], baseFn);
    const result = await chain(baseCtx);
    expect(result).toEqual(samplePrompts);
  });

  it("single middleware can filter prompts", async () => {
    const baseFn = async () => samplePrompts;
    const mw: Middleware = {
      onListPrompts: async (_ctx, callNext) => {
        const prompts = await callNext();
        return prompts.filter((p) => p.name === "prompt-a");
      },
    };
    const chain = buildListPromptsChain([mw], baseFn);
    const result = await chain(baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("prompt-a");
  });

  it("multiple middlewares chain in registration order", async () => {
    const order: string[] = [];
    const baseFn = async () => {
      order.push("base");
      return samplePrompts;
    };
    const mw1: Middleware = {
      onListPrompts: async (_ctx, callNext) => {
        order.push("mw1-before");
        const result = await callNext();
        order.push("mw1-after");
        return result;
      },
    };
    const mw2: Middleware = {
      onListPrompts: async (_ctx, callNext) => {
        order.push("mw2-before");
        const result = await callNext();
        order.push("mw2-after");
        return result;
      },
    };
    const chain = buildListPromptsChain([mw1, mw2], baseFn);
    await chain(baseCtx);
    expect(order).toEqual([
      "mw1-before",
      "mw2-before",
      "base",
      "mw2-after",
      "mw1-after",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildListResourcesChain
// ---------------------------------------------------------------------------
describe("buildListResourcesChain", () => {
  const sampleResources: ResourceInfo[] = [
    { uri: "file:///a.txt", name: "a" },
    { uri: "file:///b.txt", name: "b" },
  ];

  it("passes through base result when no middlewares are registered", async () => {
    const baseFn = async () => sampleResources;
    const chain = buildListResourcesChain([], baseFn);
    const result = await chain(baseCtx);
    expect(result).toEqual(sampleResources);
  });

  it("single middleware can filter resources", async () => {
    const baseFn = async () => sampleResources;
    const mw: Middleware = {
      onListResources: async (_ctx, callNext) => {
        const resources = await callNext();
        return resources.filter((r) => r.name === "a");
      },
    };
    const chain = buildListResourcesChain([mw], baseFn);
    const result = await chain(baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("a");
  });

  it("multiple middlewares chain in registration order", async () => {
    const order: string[] = [];
    const baseFn = async () => {
      order.push("base");
      return sampleResources;
    };
    const mw1: Middleware = {
      onListResources: async (_ctx, callNext) => {
        order.push("mw1-before");
        const result = await callNext();
        order.push("mw1-after");
        return result;
      },
    };
    const mw2: Middleware = {
      onListResources: async (_ctx, callNext) => {
        order.push("mw2-before");
        const result = await callNext();
        order.push("mw2-after");
        return result;
      },
    };
    const chain = buildListResourcesChain([mw1, mw2], baseFn);
    await chain(baseCtx);
    expect(order).toEqual([
      "mw1-before",
      "mw2-before",
      "base",
      "mw2-after",
      "mw1-after",
    ]);
  });
});

// ---------------------------------------------------------------------------
// MCPServer.use() integration
// ---------------------------------------------------------------------------
describe("MCPServer.use() integration", () => {
  it("registers middleware and returns this for chaining", async () => {
    // Dynamic import to avoid pulling in server startup logic at module level
    const { MCPServer } = await import("../../../src/server/mcp-server.js");
    const server = new MCPServer({ name: "test", version: "1.0.0" });

    const result = server
      .use({ name: "mw1", onListTools: async (_ctx, next) => next() })
      .use({ name: "mw2", onCallTool: async (_ctx, _p, next) => next() });

    // use() returns the proxy for chaining — same reference
    expect(result).toBe(server);
  });

  it("middleware applied to tools/list via real server instance", async () => {
    const { MCPServer } = await import("../../../src/server/mcp-server.js");
    const server = new MCPServer({ name: "test", version: "1.0.0" });
    const { z } = await import("zod");

    // Register tools
    server.tool(
      { name: "public-tool", description: "Public", schema: z.object({}) },
      async () => ({ content: [{ type: "text" as const, text: "ok" }] })
    );
    server.tool(
      { name: "admin-tool", description: "Admin only", schema: z.object({}) },
      async () => ({ content: [{ type: "text" as const, text: "ok" }] })
    );

    // Register filtering middleware
    server.use({
      name: "admin-filter",
      onListTools: async (_ctx, callNext) => {
        const tools = await callNext();
        return tools.filter((t) => !t.name.startsWith("admin-"));
      },
    });

    // Create a session server (this is how the SDK works in production)
    const sessionServer = server.getServerForSession("test-session");

    // Access the internal request handlers to verify the middleware-wrapped handler
    const handler = (sessionServer.server as any)._requestHandlers?.get(
      "tools/list"
    );
    expect(handler).toBeDefined();

    // Call the handler directly
    const result = await handler(
      { method: "tools/list", params: {} },
      {}
    );
    expect(result.tools).toBeDefined();
    expect(result.tools.map((t: any) => t.name)).toEqual(["public-tool"]);
  });

  it("middleware applied to prompts/list via real server instance", async () => {
    const { MCPServer } = await import("../../../src/server/mcp-server.js");
    const server = new MCPServer({ name: "test", version: "1.0.0" });

    server.prompt(
      { name: "public-prompt", description: "Public" },
      async () => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: "public" } }],
      })
    );
    server.prompt(
      { name: "admin-prompt", description: "Admin only" },
      async () => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: "admin" } }],
      })
    );

    server.use({
      name: "prompt-filter",
      onListPrompts: async (_ctx, callNext) => {
        const prompts = await callNext();
        return prompts.filter((p) => !p.name.startsWith("admin-"));
      },
    });

    const sessionServer = server.getServerForSession("test-session-prompts");
    const handler = (sessionServer.server as any)._requestHandlers?.get(
      "prompts/list"
    );
    expect(handler).toBeDefined();

    const result = await handler({ method: "prompts/list", params: {} }, {});
    expect(result.prompts.map((p: any) => p.name)).toEqual(["public-prompt"]);
  });

  it("middleware applied to resources/list via real server instance", async () => {
    const { MCPServer } = await import("../../../src/server/mcp-server.js");
    const server = new MCPServer({ name: "test", version: "1.0.0" });

    server.resource(
      { uri: "file:///public.txt", name: "public-resource" },
      async () => ({
        contents: [{ uri: "file:///public.txt", text: "content" }],
      })
    );
    server.resource(
      { uri: "file:///secret.txt", name: "secret-resource" },
      async () => ({
        contents: [{ uri: "file:///secret.txt", text: "secret" }],
      })
    );

    server.use({
      name: "resource-filter",
      onListResources: async (_ctx, callNext) => {
        const resources = await callNext();
        return resources.filter((r) => !r.name.startsWith("secret-"));
      },
    });

    const sessionServer = server.getServerForSession("test-session-resources");
    const handler = (sessionServer.server as any)._requestHandlers?.get(
      "resources/list"
    );
    expect(handler).toBeDefined();

    const result = await handler(
      { method: "resources/list", params: {} },
      {}
    );
    expect(result.resources.map((r: any) => r.name)).toEqual([
      "public-resource",
    ]);
  });
});
