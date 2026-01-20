import { describe, expect, it } from "vitest";
import { attachToolResults } from "../../../src/runtime/toolResultCapture.js";
import type { ToolCall } from "../../../src/runtime/types.js";

describe("attachToolResults", () => {
  it("maps tool messages to tool calls in order", () => {
    const toolCalls: ToolCall[] = [
      {
        name: "add",
        input: { a: 1, b: 2 },
        durationMs: 0,
        startedAt: Date.now() - 5,
      },
      {
        name: "add",
        input: { a: 5, b: 7 },
        durationMs: 0,
        startedAt: Date.now() - 5,
      },
    ];

    const messages = [
      { type: "tool", content: JSON.stringify({ result: 3 }) },
      {
        type: "tool",
        content: JSON.stringify({ error: { code: "BAD_INPUT" } }),
      },
    ];

    attachToolResults(toolCalls, messages as any);

    expect(toolCalls[0].output).toEqual({ kind: "json", value: { result: 3 } });
    expect(toolCalls[1].error).toEqual({
      kind: "json",
      value: { code: "BAD_INPUT" },
    });
  });
});
