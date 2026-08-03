import { describe, expect, it, vi } from "vitest";
import type { LlmDriver } from "../driver.js";
import { streamNativeAgentSteps } from "../native_runner.js";

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
});
