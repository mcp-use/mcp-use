import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractFunctionCalls,
  responsesReasoningFields,
  seedInputFromMessages,
  streamResponsesTurn,
} from "../providers/openai-responses";
import { OpenAIResponsesDriver } from "../providers/openai-responses-driver";
import { streamNativeAgentSteps } from "../native_runner";
import { toolResultToContent } from "../toolResultParts";
import type { LlmStreamEvent, ProviderMessage, ProviderTool } from "../types";

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

/** A `Response` whose body streams the given Responses events as SSE. */
function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { status: 200 }
  );
}

/**
 * Wire shape of a streamed tool call. The arguments events carry `item_id`
 * (the output item's `id`), never `call_id`.
 *
 * `correlation` selects which of the two the arguments events carry, so the
 * nonstandard `call_id` producer can be exercised too. `itemId` is `null` for
 * a producer that omits the output item's `id` altogether.
 */
function toolCallEvents(
  callId = "call_abc",
  itemId: string | null = "fc_abc",
  correlation: "item_id" | "call_id" = "item_id"
): unknown[] {
  const correlationValue = correlation === "item_id" ? itemId : callId;
  return [
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        ...(itemId === null ? {} : { id: itemId }),
        call_id: callId,
        name: "get_weather",
        arguments: "",
      },
    },
    {
      type: "response.function_call_arguments.delta",
      [correlation]: correlationValue,
      output_index: 0,
      delta: '{"city":',
      sequence_number: 1,
    },
    {
      type: "response.function_call_arguments.delta",
      [correlation]: correlationValue,
      output_index: 0,
      delta: '"Paris"}',
      sequence_number: 2,
    },
    {
      type: "response.function_call_arguments.done",
      [correlation]: correlationValue,
      output_index: 0,
      arguments: '{"city":"Paris"}',
      sequence_number: 3,
    },
    {
      type: "response.completed",
      response: {
        output: [
          {
            type: "function_call",
            id: itemId,
            call_id: callId,
            name: "get_weather",
            arguments: '{"city":"Paris"}',
          },
        ],
      },
    },
  ];
}

const TOOLS: ProviderTool[] = [
  { name: "get_weather", inputSchema: { type: "object" } },
];

describe("Responses SSE event mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits tool-call-args-delta and tool-call-ready against the call_id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse(toolCallEvents()))
    );

    const turn = streamResponsesTurn({
      config: { provider: "openai", model: "gpt-4o-mini", apiKey: "k" },
      input: [{ role: "user", content: "weather in Paris?" }],
      tools: TOOLS,
    });
    const events: LlmStreamEvent[] = [];
    for (;;) {
      const next = await turn.next();
      if (next.done) break;
      events.push(next.value);
    }

    expect(events).toContainEqual({
      type: "tool-call-args-delta",
      index: 0,
      toolCallId: "call_abc",
      toolName: "get_weather",
      argsDelta: '{"city":',
    });
    expect(events).toContainEqual({
      type: "tool-call-ready",
      index: 0,
      toolCallId: "call_abc",
      toolName: "get_weather",
      args: { city: "Paris" },
    });
  });

  it.each([
    ["an item id", "fc_abc"],
    ["no item id", null],
  ] as const)(
    "still correlates argument events from a call_id-only producer with %s",
    async (_producer, itemId) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            sseResponse(toolCallEvents("call_abc", itemId, "call_id"))
          )
      );

      const turn = streamResponsesTurn({
        config: { provider: "openai", model: "gpt-4o-mini", apiKey: "k" },
        input: [{ role: "user", content: "weather in Paris?" }],
        tools: TOOLS,
      });
      const events: LlmStreamEvent[] = [];
      for (;;) {
        const next = await turn.next();
        if (next.done) break;
        events.push(next.value);
      }

      expect(events).toContainEqual({
        type: "tool-call-args-delta",
        index: 0,
        toolCallId: "call_abc",
        toolName: "get_weather",
        argsDelta: '{"city":',
      });
      expect(events).toContainEqual({
        type: "tool-call-ready",
        index: 0,
        toolCallId: "call_abc",
        toolName: "get_weather",
        args: { city: "Paris" },
      });
    }
  );

  it("keeps calls apart when one call's item id is another's call id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              type: "function_call",
              id: "fc_shared",
              call_id: "call_first",
              name: "first_tool",
              arguments: "",
            },
          },
          {
            type: "response.output_item.added",
            output_index: 1,
            item: {
              type: "function_call",
              id: "fc_second",
              // A different call, whose call_id happens to equal the first
              // call's item id. The two identifiers come from the producer
              // and share no namespace, so they must not share a key.
              call_id: "fc_shared",
              name: "second_tool",
              arguments: "",
            },
          },
          {
            type: "response.function_call_arguments.delta",
            item_id: "fc_shared",
            output_index: 0,
            delta: '{"n":1}',
            sequence_number: 1,
          },
          {
            type: "response.function_call_arguments.done",
            item_id: "fc_shared",
            output_index: 0,
            arguments: '{"n":1}',
            sequence_number: 2,
          },
        ])
      )
    );

    const turn = streamResponsesTurn({
      config: { provider: "openai", model: "gpt-4o-mini", apiKey: "k" },
      input: [{ role: "user", content: "run both" }],
      tools: TOOLS,
    });
    const events: LlmStreamEvent[] = [];
    for (;;) {
      const next = await turn.next();
      if (next.done) break;
      events.push(next.value);
    }

    // The argument events name the first call's item id, so they belong to it
    expect(events).toContainEqual({
      type: "tool-call-args-delta",
      index: 0,
      toolCallId: "call_first",
      toolName: "first_tool",
      argsDelta: '{"n":1}',
    });
    expect(events).toContainEqual({
      type: "tool-call-ready",
      index: 0,
      toolCallId: "call_first",
      toolName: "first_tool",
      args: { n: 1 },
    });
  });

  it("yields AgentSteps for a streamed OpenAI Responses tool call", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sseResponse(toolCallEvents()))
        .mockResolvedValueOnce(
          sseResponse([
            { type: "response.output_text.delta", delta: "18C" },
            { type: "response.completed", response: { output: [] } },
          ])
        )
    );

    const driver = new OpenAIResponsesDriver({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    const steps: unknown[] = [];
    for await (const step of streamNativeAgentSteps(driver, {
      messages: [{ role: "user", content: "weather in Paris?" }],
      tools: TOOLS,
      callTool: async () => "18C",
    })) {
      steps.push(step);
    }

    expect(steps).toEqual([
      {
        action: {
          tool: "get_weather",
          toolInput: { city: "Paris" },
          log: "Calling tool get_weather",
        },
        observation: "",
      },
      {
        action: {
          tool: "get_weather",
          toolInput: { city: "Paris" },
          log: "Calling tool get_weather",
        },
        observation: "18C",
      },
    ]);
  });
});
