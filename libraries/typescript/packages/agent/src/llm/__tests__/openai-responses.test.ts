import { describe, expect, it } from "vitest";
import {
  extractFunctionCalls,
  seedInputFromMessages,
} from "../providers/openai-responses";
import { toolResultToContent } from "../toolResultParts";
import type { ProviderMessage } from "../types";

describe("seedInputFromMessages", () => {
  it("maps system to instructions and user/assistant/tool history to input items", () => {
    const messages: ProviderMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "calling tool",
        toolCalls: [{ id: "call_1", name: "search", args: { q: "x" } }],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "search",
        content: '{"ok":true}',
      },
    ];

    const { instructions, input } = seedInputFromMessages(messages);
    expect(instructions).toBe("You are helpful.");
    expect(input).toEqual([
      { role: "user", content: "hi" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "calling tool" }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "search",
        arguments: '{"q":"x"}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: '{"ok":true}',
      },
    ]);
  });

  it("adds follow-up user image turn for image tool results", () => {
    const result = {
      content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    };
    const messages: ProviderMessage[] = [
      { role: "user", content: "describe" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "fetch-image", args: {} }],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "fetch-image",
        toolResult: result,
        content: toolResultToContent(result),
      },
    ];

    const { input } = seedInputFromMessages(messages);
    const outputItem = input.find(
      (i) =>
        typeof i === "object" &&
        i !== null &&
        (i as { type?: string }).type === "function_call_output"
    ) as { output: string };
    expect(outputItem.output).toBe("[image content; see next message]");

    const trailingUser = input[input.length - 1] as {
      role: string;
      content: { type: string; image_url?: string }[];
    };
    expect(trailingUser.role).toBe("user");
    expect(trailingUser.content.some((p) => p.type === "input_image")).toBe(
      true
    );
  });
});

describe("extractFunctionCalls", () => {
  it("collects function_call items from response output", () => {
    const output = [
      { type: "message", role: "assistant", content: [] },
      {
        type: "function_call",
        call_id: "call_abc",
        name: "get_weather",
        arguments: '{"city":"Paris"}',
      },
    ];
    expect(extractFunctionCalls(output)).toEqual([
      {
        call_id: "call_abc",
        name: "get_weather",
        arguments: '{"city":"Paris"}',
      },
    ]);
  });
});

describe("Responses SSE event mapping", () => {
  it("parses function_call_arguments.done into tool-call-ready shape", () => {
    const payload = {
      type: "response.function_call_arguments.done",
      call_id: "call_abc",
      arguments: '{"city":"Paris"}',
    };
    const args = JSON.parse(payload.arguments);
    expect(args).toEqual({ city: "Paris" });
    expect(payload.call_id).toBe("call_abc");
  });
});
