import type { BaseConnector } from "@mcp-use/client";
import type { Prompt } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { LangChainAdapter } from "../../src/adapters/langchain_adapter.js";
import { NativeAdapter } from "../../src/adapters/native_adapter.js";

function createConnector(args?: Prompt["arguments"]) {
  const getPrompt = vi.fn().mockResolvedValue({ messages: [] });
  const connector = {
    tools: [{ name: "available", inputSchema: { type: "object" } }],
    listPrompts: vi.fn().mockResolvedValue({
      prompts: [{ name: "review", arguments: args }],
    }),
    getPrompt,
  } as unknown as BaseConnector;
  return { connector, getPrompt };
}

const cases: {
  name: string;
  args?: Prompt["arguments"];
  required: string[];
  input: Record<string, string>;
}[] = [
  {
    name: "an omitted required flag",
    args: [{ name: "style" }],
    required: [],
    input: {},
  },
  {
    name: "required: false",
    args: [{ name: "style", required: false }],
    required: [],
    input: {},
  },
  {
    name: "required: true",
    args: [{ name: "topic", required: true }],
    required: ["topic"],
    input: { topic: "MCP" },
  },
  {
    name: "mixed required and optional arguments",
    args: [
      { name: "topic", required: true },
      { name: "style" },
      { name: "tone", required: false },
    ],
    required: ["topic"],
    input: { topic: "MCP" },
  },
  { name: "no arguments field", required: [], input: {} },
  { name: "an empty arguments list", args: [], required: [], input: {} },
];

describe("NativeAdapter prompt arguments", () => {
  it.each(cases)("preserves $name", async ({ args, required, input }) => {
    const { connector, getPrompt } = createConnector(args);
    const adapter = new NativeAdapter();
    const [tool] = await adapter.createPromptsFromConnectors([connector]);

    expect(tool.inputSchema.required ?? []).toEqual(required);
    expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(
      args?.map((arg) => arg.name) ?? []
    );
    await adapter.createCallTool()(tool.name, input);
    expect(getPrompt).toHaveBeenCalledExactlyOnceWith("review", input);
  });
});

describe("LangChainAdapter prompt arguments", () => {
  it.each(cases)("preserves $name", async ({ args, required, input }) => {
    const { connector, getPrompt } = createConnector(args);
    const adapter = new LangChainAdapter();
    const [tool] = await adapter.createPromptsFromConnectors([connector]);

    if (required.length > 0) {
      await expect(tool.invoke({})).rejects.toThrow();
      expect(getPrompt).not.toHaveBeenCalled();
    }
    await tool.invoke(input);
    expect(getPrompt).toHaveBeenCalledExactlyOnceWith("review", input);
  });
});
