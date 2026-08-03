import { describe, expect, it, vi } from "vitest";
import { CodeModeConnector } from "../../../src/code-mode/connector.js";
import { BaseCodeExecutor } from "../../../src/code-mode/executor.js";
import type { ExecutionResult } from "../../../src/code-mode/executor.js";
import { MCPClient } from "../../../src/core/node.js";

function ok(result: unknown): ExecutionResult {
  return { result, logs: [], error: null, execution_time: 0 };
}

describe("codeMode with a custom executor function", () => {
  it("uses the custom function on the first executeCode call", async () => {
    const fn = vi.fn(async (code: string) => ok(`ran:${code}`));
    const client = new MCPClient(
      {},
      { codeMode: { enabled: true, executor: fn } }
    );

    await expect(client.executeCode("return 1")).resolves.toMatchObject({
      result: "ran:return 1",
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("return 1", undefined);
  });

  it("forwards the timeout to the custom function", async () => {
    const fn = vi.fn(async () => ok(null));
    const client = new MCPClient(
      {},
      { codeMode: { enabled: true, executor: fn } }
    );

    await client.executeCode("return 1", 1234);
    expect(fn).toHaveBeenCalledWith("return 1", 1234);
  });

  it("supports searchTools when the executor is a custom function", async () => {
    const client = new MCPClient(
      {},
      { codeMode: { enabled: true, executor: async () => ok(null) } }
    );

    await expect(client.searchTools("")).resolves.toEqual({
      meta: { total_tools: 0, namespaces: [], result_count: 0 },
      results: [],
    });
  });

  it("close() cleans up a custom function executor", async () => {
    const client = new MCPClient(
      {},
      { codeMode: { enabled: true, executor: async () => ok(null) } }
    );

    await client.executeCode("return 1");
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("still supports a BaseCodeExecutor instance", async () => {
    class Custom extends BaseCodeExecutor {
      async execute(): Promise<ExecutionResult> {
        return ok("instance");
      }
      async cleanup(): Promise<void> {}
    }

    const client = new MCPClient({});
    const client2 = new MCPClient(
      {},
      { codeMode: { enabled: true, executor: new Custom(client) } }
    );

    await expect(client2.executeCode("x")).resolves.toMatchObject({
      result: "instance",
    });
  });
});

describe("CodeModeConnector search_tools detail_level", () => {
  function connectorWithSpy() {
    const searchTools = vi.fn(async () => ({
      meta: { total_tools: 0, namespaces: [], result_count: 0 },
      results: [],
    }));
    const connector = new CodeModeConnector({ searchTools } as never);
    return { connector, searchTools };
  }

  it.each(["names", "descriptions", "full"] as const)(
    "forwards detail_level %s",
    async (level) => {
      const { connector, searchTools } = connectorWithSpy();
      await connector.callTool("search_tools", {
        query: "",
        detail_level: level,
      });
      expect(searchTools).toHaveBeenCalledWith("", level);
    }
  );

  it("falls back to full for an unknown detail_level", async () => {
    const { connector, searchTools } = connectorWithSpy();
    await connector.callTool("search_tools", { detail_level: "bogus" });
    expect(searchTools).toHaveBeenCalledWith("", "full");
  });

  it("falls back to full when detail_level is omitted", async () => {
    const { connector, searchTools } = connectorWithSpy();
    await connector.callTool("search_tools", {});
    expect(searchTools).toHaveBeenCalledWith("", "full");
  });
});
