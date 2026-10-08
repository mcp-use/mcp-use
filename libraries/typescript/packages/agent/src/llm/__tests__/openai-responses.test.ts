import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractFunctionCalls,
  responsesReasoningFields,
  seedInputFromMessages,
  streamResponsesTurn,
} from "../providers/openai-responses";
import { OpenAIResponsesDriver } from "../providers/openai-responses-driver";
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

describe("streamResponsesTurn function-call argument events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys argument deltas by item_id and emits tool-call-ready with parsed args", async () => {
    const sseLines = [
      'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_abc","name":"get_weather","arguments":""}}',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"{\\"city\\":"}',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","output_index":0,"delta":"\\"Paris\\"}"}',
      'data: {"type":"response.function_call_arguments.done","item_id":"fc_1","output_index":0,"arguments":"{\\"city\\":\\"Paris\\"}"}',
      'data: {"type":"response.completed","response":{"status":"completed","output":[{"id":"fc_1","type":"function_call","call_id":"call_abc","name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}]}}',
      "data: [DONE]",
    ].join("\n\n") + "\n\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(sseLines, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );

    const events: Array<Record<string, unknown>> = [];
    const turn = streamResponsesTurn({
      config: { provider: "openai", model: "gpt-5", apiKey: "k" },
      input: [],
      tools: [],
    });
    for (;;) {
      const next = await turn.next();
      if (next.done) break;
      events.push(next.value as Record<string, unknown>);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("tool-call-start");
    const deltas = events.filter((e) => e.type === "tool-call-args-delta");
    expect(deltas).toHaveLength(2);
    const ready = events.find((e) => e.type === "tool-call-ready") as
      | { toolCallId: string; args: Record<string, unknown> }
      | undefined;
    expect(ready).toBeDefined();
    expect(ready!.toolCallId).toBe("call_abc");
    expect(ready!.args).toEqual({ city: "Paris" });
  });
});

describe("OpenAIResponsesDriver.runToolLoopNonStreaming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops dispatching remaining tool calls in a turn when signal is aborted", async () => {
    const controller = new AbortController();
    const callTool = vi.fn(async (name: string) => {
      if (name === "tool1") {
        controller.abort();
      }
      return { ok: true };
    });

    const driver = new OpenAIResponsesDriver({ apiKey: "test-key" });

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "1",
                name: "tool1",
                arguments: "{}",
              },
              {
                type: "function_call",
                call_id: "2",
                name: "tool2",
                arguments: "{}",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await driver.runToolLoopNonStreaming({
      driver,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callTool,
      signal: controller.signal,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("tool1", {});
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe("tool1");
  });

  it("does not dispatch tool calls when signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const callTool = vi.fn(async () => ({ ok: true }));
    const driver = new OpenAIResponsesDriver({ apiKey: "test-key" });

    const result = await driver.runToolLoopNonStreaming({
      driver,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callTool,
      signal: controller.signal,
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.toolCalls).toHaveLength(0);
  });
});
