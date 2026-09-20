import { describe, expect, it, vi } from "vitest";
import {
  extractFunctionCalls,
  responsesReasoningFields,
  seedInputFromMessages,
  streamResponsesTurn,
} from "../providers/openai-responses";
import { toolResultToContent } from "../toolResultParts";
import type { ProviderMessage } from "../types";

async function collectStream(events: Record<string, unknown>[]) {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(body, { status: 200 }));
  const result = [];
  try {
    for await (const event of streamResponsesTurn({
      config: { provider: "openai", model: "gpt-4o-mini", apiKey: "test" },
      input: [],
      tools: [],
    })) {
      result.push(event);
    }
  } finally {
    fetchMock.mockRestore();
  }
  return result;
}

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

describe("responsesReasoningFields", () => {
  it("omits reasoning params by default", () => {
    expect(
      responsesReasoningFields({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "k",
      })
    ).toEqual({});
  });

  it("omits reasoning params when effort is none", () => {
    expect(
      responsesReasoningFields({
        provider: "openai",
        model: "o3-mini",
        apiKey: "k",
        reasoningEffort: "none",
      })
    ).toEqual({});
  });

  it("includes reasoning params when effort is set", () => {
    expect(
      responsesReasoningFields({
        provider: "openai",
        model: "o3-mini",
        apiKey: "k",
        reasoningEffort: "low",
      })
    ).toEqual({
      include: ["reasoning.encrypted_content"],
      reasoning: { effort: "low" },
    });
  });
});

describe("Responses SSE event mapping", () => {
  it("keeps compatibility call_id matching unambiguous across item boundaries", async () => {
    const result = await collectStream([
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "first",
          call_id: "shared",
          name: "one",
        },
      },
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "second",
          call_id: "shared",
          name: "two",
        },
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "first",
        arguments: '{"first":true}',
      },
      {
        type: "response.function_call_arguments.done",
        call_id: "shared",
        arguments: '{"second":true}',
      },
    ]);

    expect(result).toContainEqual({
      type: "tool-call-ready",
      index: 1,
      toolCallId: "shared",
      toolName: "two",
      args: { second: true },
    });
  });

  it("does not attach an ambiguous compatibility event when item IDs are missing", async () => {
    const result = await collectStream([
      {
        type: "response.output_item.added",
        item: { type: "function_call", call_id: "shared", name: "one" },
      },
      {
        type: "response.output_item.added",
        item: { type: "function_call", call_id: "shared", name: "two" },
      },
      {
        type: "response.function_call_arguments.done",
        call_id: "shared",
        arguments: '{"wrong":true}',
      },
    ]);

    expect(result.filter((event) => event.type === "tool-call-ready")).toEqual(
      []
    );
  });

  it("falls back to call_id when a supplied item_id does not match", async () => {
    const result = await collectStream([
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "actual",
          call_id: "call_abc",
          name: "weather",
        },
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "stale",
        call_id: "call_abc",
        arguments: '{"city":"Paris"}',
      },
    ]);

    expect(result).toContainEqual({
      type: "tool-call-ready",
      index: 0,
      toolCallId: "call_abc",
      toolName: "weather",
      args: { city: "Paris" },
    });
  });

  it("matches function argument events by item_id while preserving call_id", async () => {
    const events = [
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_abc",
          name: "get_weather",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_123",
        delta: '{"city":',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_123",
        arguments: '{"city":"Paris"}',
      },
    ];
    const result = await collectStream(events);

    expect(result).toEqual([
      {
        type: "tool-call-start",
        index: 0,
        toolCallId: "call_abc",
        toolName: "get_weather",
      },
      {
        type: "tool-call-args-delta",
        index: 0,
        toolCallId: "call_abc",
        toolName: "get_weather",
        argsDelta: '{"city":',
      },
      {
        type: "tool-call-ready",
        index: 0,
        toolCallId: "call_abc",
        toolName: "get_weather",
        args: { city: "Paris" },
      },
      { type: "done" },
    ]);
  });

  it("matches function argument done events by call_id for compatibility producers", async () => {
    const events = [
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "fc_123",
          call_id: "call_abc",
          name: "get_weather",
        },
      },
      {
        type: "response.function_call_arguments.done",
        call_id: "call_abc",
        arguments: '{"city":"Paris"}',
      },
    ];
    const result = await collectStream(events);

    expect(result).toEqual([
      {
        type: "tool-call-start",
        index: 0,
        toolCallId: "call_abc",
        toolName: "get_weather",
      },
      {
        type: "tool-call-ready",
        index: 0,
        toolCallId: "call_abc",
        toolName: "get_weather",
        args: { city: "Paris" },
      },
      { type: "done" },
    ]);
  });

  it("ignores unknown and ambiguous compatibility IDs without changing another call", async () => {
    const events = [
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "item_one",
          call_id: "shared",
          name: "one",
        },
      },
      {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: "item_two",
          call_id: "shared",
          name: "two",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        call_id: "shared",
        delta: '{"wrong":true}',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "missing",
        arguments: '{"wrong":true}',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "item_two",
        arguments: '{"right":true}',
      },
    ];
    const result = await collectStream(events);

    expect(result).toEqual([
      {
        type: "tool-call-start",
        index: 0,
        toolCallId: "shared",
        toolName: "one",
      },
      {
        type: "tool-call-start",
        index: 1,
        toolCallId: "shared",
        toolName: "two",
      },
      {
        type: "tool-call-ready",
        index: 1,
        toolCallId: "shared",
        toolName: "two",
        args: { right: true },
      },
      { type: "done" },
    ]);
  });

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
