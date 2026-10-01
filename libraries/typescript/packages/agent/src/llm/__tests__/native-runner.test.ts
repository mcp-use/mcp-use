import { describe, expect, it, vi } from "vitest";
import type { LlmDriver } from "../driver.js";
import { runNativeAgent, streamNativeAgentSteps } from "../native_runner.js";

// The model writes a short preamble and calls a tool, then answers.
function preambleThenAnswerDriver(): LlmDriver {
  let turn = 0;
  return {
    async *stream() {
      turn += 1;
      if (turn === 1) {
        yield { type: "text-delta", delta: "Let me check the files." };
        yield {
          type: "tool-call-ready",
          index: 0,
          toolCallId: "call_a",
          toolName: "list_files",
          args: {},
        };
      } else {
        yield { type: "text-delta", delta: "The folder has " };
        yield { type: "text-delta", delta: "a.ts." };
      }
      yield { type: "done" };
    },
    async complete() {
      turn += 1;
      return turn === 1
        ? {
            text: "Let me check the files.",
            toolCalls: [{ id: "call_a", name: "list_files", args: {} }],
          }
        : { text: "The folder has a.ts.", toolCalls: [] };
    },
  };
}

describe("streamNativeAgentSteps", () => {
  it("pairs parallel tool results by toolCallId", async () => {
    const driver: LlmDriver = {
      managesToolLoop: true,
      async *stream() {},
      async complete() {
        return { text: "", toolCalls: [] };
      },
      async *streamToolLoop() {
        yield {
          type: "tool-call-ready",
          index: 0,
          toolCallId: "call_a",
          toolName: "alpha",
          args: { value: 1 },
        };
        yield {
          type: "tool-call-ready",
          index: 1,
          toolCallId: "call_b",
          toolName: "beta",
          args: { value: 2 },
        };
        yield {
          type: "tool-result",
          toolCallId: "call_b",
          toolName: "beta",
          result: "beta result",
          isError: false,
        };
        yield {
          type: "tool-result",
          toolCallId: "call_a",
          toolName: "alpha",
          result: "alpha result",
          isError: false,
        };
      },
    };
    const steps = [];

    for await (const step of streamNativeAgentSteps(driver, {
      messages: [],
      tools: [],
      callTool: vi.fn(),
    })) {
      steps.push(step);
    }

    expect(steps.slice(2)).toEqual([
      {
        action: {
          tool: "beta",
          toolInput: { value: 2 },
          log: "Calling tool beta",
        },
        observation: "beta result",
      },
      {
        action: {
          tool: "alpha",
          toolInput: { value: 1 },
          log: "Calling tool alpha",
        },
        observation: "alpha result",
      },
    ]);
  });

  it("returns only the final turn's text, like runNativeAgent", async () => {
    const options = {
      messages: [],
      tools: [],
      callTool: vi.fn().mockResolvedValue("a.ts"),
    };

    const steps = streamNativeAgentSteps(preambleThenAnswerDriver(), options);
    let next = await steps.next();
    while (!next.done) {
      next = await steps.next();
    }

    expect(next.value).toBe("The folder has a.ts.");
    await expect(
      runNativeAgent(preambleThenAnswerDriver(), options)
    ).resolves.toBe("The folder has a.ts.");
  });
});
