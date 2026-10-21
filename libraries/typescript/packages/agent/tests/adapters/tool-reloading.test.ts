import type { BaseConnector } from "@mcp-use/client";
import { describe, expect, it, vi } from "vitest";
import { LangChainAdapter } from "../../src/adapters/langchain_adapter.js";
import { NativeAdapter } from "../../src/adapters/native_adapter.js";

vi.mock("@mcp-use/client", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeConnector(text: string): BaseConnector {
  return {
    tools: [
      {
        name: "echo",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    callTool: vi.fn(async () => ({ content: [{ type: "text", text }] })),
  } as unknown as BaseConnector;
}

describe("adapter tool loading cycles", () => {
  it("rebuilds native dispatch when the same connector is loaded again", async () => {
    const connector = makeConnector("hello");
    const adapter = new NativeAdapter();

    for (let cycle = 0; cycle < 2; cycle++) {
      const tools = await adapter.createToolsFromConnectors([connector]);
      expect(tools.map((tool) => tool.name)).toEqual(["echo"]);
      await expect(adapter.createCallTool()("echo", {})).resolves.toEqual({
        content: [{ type: "text", text: "hello" }],
      });
    }
    expect(connector.callTool).toHaveBeenCalledTimes(2);
  });

  it("rebuilds native dispatch after an empty loading cycle", async () => {
    const connector = makeConnector("hello");
    const adapter = new NativeAdapter();
    await adapter.createToolsFromConnectors([connector]);
    expect(await adapter.createToolsFromConnectors([])).toEqual([]);
    await adapter.createToolsFromConnectors([connector]);

    await expect(adapter.createCallTool()("echo", {})).resolves.toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });

  it("reserves native names again when adding a same-named tool", async () => {
    const first = makeConnector("first");
    const second = makeConnector("second");
    const adapter = new NativeAdapter();
    await adapter.createToolsFromConnectors([first]);

    const tools = await adapter.createToolsFromConnectors([first, second]);
    expect(tools.map((tool) => tool.name)).toEqual(["echo", "echo_2"]);
    const callTool = adapter.createCallTool();
    await expect(callTool("echo", {})).resolves.toEqual({
      content: [{ type: "text", text: "first" }],
    });
    await expect(callTool("echo_2", {})).resolves.toEqual({
      content: [{ type: "text", text: "second" }],
    });
  });

  it("keeps LangChain tool names unique and closures callable on reload", async () => {
    const first = makeConnector("first");
    const second = makeConnector("second");
    const adapter = new LangChainAdapter();
    await adapter.createToolsFromConnectors([first]);

    const tools = await adapter.createToolsFromConnectors([first, second]);
    expect(tools.map((tool) => tool.name)).toEqual(["echo", "echo_2"]);
    expect(JSON.parse(await tools[0].invoke({}))).toEqual({
      content: [{ type: "text", text: "first" }],
    });
    expect(JSON.parse(await tools[1].invoke({}))).toEqual({
      content: [{ type: "text", text: "second" }],
    });
  });

  it.each(["native", "langchain"])(
    "preserves individual loader caching for the %s adapter",
    async (kind) => {
      const connector = makeConnector("hello");
      const adapter =
        kind === "native" ? new NativeAdapter() : new LangChainAdapter();
      const first = await adapter.loadToolsForConnector(connector);
      expect(await adapter.loadToolsForConnector(connector)).toBe(first);
    }
  );
});
