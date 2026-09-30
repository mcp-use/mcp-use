import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "langchain";
import { describe, expect, it } from "vitest";
import {
  convertExternalHistoryToProvider,
  convertMessagesToProvider,
} from "../messageFormat";

describe("convertMessagesToProvider", () => {
  it("keeps generated tool call ids within provider id limits", () => {
    // OpenAI rejects tool call ids longer than 40 characters, so the id must
    // not grow with the tool name.
    const toolName = "search_customer_support_tickets_by_status";
    const out = convertMessagesToProvider([
      { role: "user", content: "trigger" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: { toolName, args: {}, result: { content: [] } },
          },
          {
            type: "tool-invocation",
            toolInvocation: { toolName, args: {}, result: { content: [] } },
          },
        ],
      },
    ]);
    const assistant = out.find((m) => m.role === "assistant");
    const ids = assistant!.toolCalls!.map((call) => call.id);
    const toolIds = out
      .filter((m) => m.role === "tool")
      .map((m) => m.toolCallId);

    expect(new Set(ids).size).toBe(2);
    expect(toolIds).toEqual(ids);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(40);
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it("propagates toolIsError when the saved MCP result has isError: true", () => {
    const out = convertMessagesToProvider([
      { role: "user", content: "trigger" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolName: "boom",
              args: {},
              result: {
                isError: true,
                content: [{ type: "text", text: "kaboom" }],
              },
            },
          },
        ],
      },
    ]);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolIsError).toBe(true);
  });

  it("preserves toolIsError across replay when the saved result is a synthetic throw payload", () => {
    // toolLoop.ts records `{ isError: true, error: "..." }` when callTool
    // throws; the replay path must still flag the tool message as an error.
    const out = convertMessagesToProvider([
      { role: "user", content: "trigger" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolName: "thrower",
              args: {},
              result: { isError: true, error: "boom" },
            },
          },
        ],
      },
    ]);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolIsError).toBe(true);
  });

  it("leaves toolIsError false when the saved result has no error flag", () => {
    const out = convertMessagesToProvider([
      { role: "user", content: "trigger" },
      {
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool-invocation",
            toolInvocation: {
              toolName: "ok",
              args: {},
              result: { content: [{ type: "text", text: "fine" }] },
            },
          },
        ],
      },
    ]);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolIsError).toBe(false);
  });
});

describe("convertExternalHistoryToProvider", () => {
  it("converts supported LangChain history in order", () => {
    expect(
      convertExternalHistoryToProvider([
        new SystemMessage("Follow policy"),
        new HumanMessage("Earlier question"),
        new AIMessage({
          content: "Calling a tool",
          tool_calls: [{ id: "call_1", name: "lookup", args: { q: "x" } }],
        }),
        new ToolMessage({
          content: "Earlier result",
          tool_call_id: "call_1",
          name: "lookup",
        }),
      ])
    ).toEqual([
      { role: "system", content: "Follow policy" },
      { role: "user", content: "Earlier question" },
      {
        role: "assistant",
        content: "Calling a tool",
        toolCalls: [{ id: "call_1", name: "lookup", args: { q: "x" } }],
      },
      {
        role: "tool",
        content: "Earlier result",
        toolCallId: "call_1",
        toolName: "lookup",
        toolResult: "Earlier result",
      },
    ]);
  });

  it("preserves errors from replayed LangChain tool messages", () => {
    expect(
      convertExternalHistoryToProvider([
        new ToolMessage({
          content: "Tool failed",
          tool_call_id: "call_error",
          status: "error",
        }),
      ])
    ).toEqual([
      {
        role: "tool",
        content: "Tool failed",
        toolCallId: "call_error",
        toolResult: "Tool failed",
        toolIsError: true,
      },
    ]);
  });
});
