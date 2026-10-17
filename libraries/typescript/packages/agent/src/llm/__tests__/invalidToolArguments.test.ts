import { afterEach, describe, expect, it, vi } from "vitest";
import { createLlmDriver } from "../driver.js";
import { runToolLoop, runToolLoopNonStreaming } from "../toolLoop.js";
import type { LlmDriver } from "../driver.js";
import type { LlmStreamEvent, ProviderConfig } from "../types.js";

const messages = [
  { role: "user", content: "Run the requested operation" },
] as const;

function providerReply(
  provider: ProviderConfig["provider"],
  args: string | string[],
  streaming: boolean
): Response {
  const items = (Array.isArray(args) ? args : [args]).map(
    (argumentsJson, index) => ({
      type: "function_call",
      id: `fc_${index + 1}`,
      call_id: `call_${index + 1}`,
      name: "record_operation",
      arguments: argumentsJson,
    })
  );
  const toolCalls = items.map((item) => ({
    id: item.call_id,
    type: "function",
    function: { name: item.name, arguments: item.arguments },
  }));
  if (!streaming) {
    return Response.json(
      provider === "openai"
        ? {
            status: "completed",
            output: items,
          }
        : { choices: [{ message: { content: "", tool_calls: toolCalls } }] }
    );
  }
  const events =
    provider === "openai"
      ? [
          ...items.flatMap((item) => [
            {
              type: "response.output_item.added",
              item: { ...item, arguments: "" },
            },
            {
              type: "response.function_call_arguments.done",
              item_id: item.id,
              arguments: item.arguments,
            },
          ]),
          {
            type: "response.completed",
            response: { status: "completed", output: items },
          },
        ]
      : [
          {
            choices: [
              {
                delta: {
                  tool_calls: toolCalls.map((call, index) => ({
                    ...call,
                    index,
                  })),
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ];
  return sseResponse(events);
}

function sseResponse(events: unknown[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  );
}

async function collect(
  events: AsyncIterable<LlmStreamEvent>
): Promise<LlmStreamEvent[]> {
  const output: LlmStreamEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

afterEach(() => vi.unstubAllGlobals());

describe.each(["openai-compatible", "openai"] as const)(
  "invalid arguments from %s",
  (provider) => {
    it.each(
      [false, true].flatMap((streaming) =>
        ['{"target":"requested"', "null", "[]"].map(
          (args) => [streaming, args] as const
        )
      )
    )(
      "does not execute invalid arguments (streaming=%s, args=%s)",
      async (streaming, rawArguments) => {
        vi.stubGlobal("fetch", async () =>
          providerReply(provider, rawArguments, streaming)
        );
        const executed: unknown[] = [];
        const params = {
          driver: createLlmDriver({
            provider,
            model: "test-model",
            apiKey: "test-key",
            baseUrl: "https://model.example/v1",
          }),
          messages: [...messages],
          tools: [],
          maxSteps: 1,
          callTool: async (_name: string, args: Record<string, unknown>) => {
            executed.push(args);
            return "completed";
          },
        };
        if (streaming) {
          const events = await collect(runToolLoop(params));
          expect(events.some((event) => event.type === "error")).toBe(true);
          expect(events.some((event) => event.type === "tool-result")).toBe(
            false
          );
        } else {
          await expect(runToolLoopNonStreaming(params)).rejects.toThrow(
            /invalid.*arguments/i
          );
        }
        expect(executed).toEqual([]);
      }
    );
  }
);

it("does not execute buffered tools after a provider error event", async () => {
  const executed: string[] = [];
  const driver: LlmDriver = {
    async *stream() {
      yield {
        type: "tool-call-ready",
        toolCallId: "call_1",
        toolName: "record_operation",
        args: {},
      };
      yield {
        type: "error",
        message: "The provider could not finish the tool turn",
      };
    },
    async complete() {
      throw new Error("streaming test");
    },
  };
  const events = await collect(
    runToolLoop({
      driver,
      messages: [...messages],
      tools: [],
      maxSteps: 1,
      callTool: async (name) => {
        executed.push(name);
        return "completed";
      },
    })
  );
  expect(events.at(-1)).toEqual({
    type: "error",
    message: "The provider could not finish the tool turn",
  });
  expect(executed).toEqual([]);
});

describe.each(["openai-compatible", "openai"] as const)(
  "valid arguments from %s",
  (provider) => {
    it.each(
      [false, true].flatMap((streaming) =>
        [
          ["", {}],
          ["{}", {}],
          ['{"target":"requested"}', { target: "requested" }],
        ].map(([raw, expected]) => ({
          streaming,
          raw: raw as string,
          expected,
        }))
      )
    )(
      "preserves valid arguments: $raw (streaming=$streaming)",
      async ({ streaming, raw, expected }) => {
        vi.stubGlobal("fetch", async () =>
          providerReply(provider, raw, streaming)
        );
        const executed: unknown[] = [];
        const params = {
          driver: createLlmDriver({
            provider,
            model: "test-model",
            apiKey: "test-key",
            baseUrl: "https://model.example/v1",
          }),
          messages: [...messages],
          tools: [],
          maxSteps: 1,
          callTool: async (_name: string, args: Record<string, unknown>) => {
            executed.push(args);
            return "completed";
          },
        };
        if (streaming) {
          const events = await collect(runToolLoop(params));
          expect(events.some((event) => event.type === "error")).toBe(false);
        } else {
          await runToolLoopNonStreaming(params);
        }
        expect(executed).toEqual([expected]);
      }
    );
  }
);

describe.each(["openai-compatible", "openai"] as const)(
  "invalid multi-call turn from %s",
  (provider) => {
    it.each([false, true])(
      "validates the whole turn before dispatch (streaming=%s)",
      async (streaming) => {
        vi.stubGlobal("fetch", async () =>
          providerReply(
            provider,
            ['{"target":"first"}', '{"target":'],
            streaming
          )
        );
        const executed: unknown[] = [];
        const params = {
          driver: createLlmDriver({
            provider,
            model: "test-model",
            apiKey: "test-key",
            baseUrl: "https://model.example/v1",
          }),
          messages: [...messages],
          tools: [],
          maxSteps: 1,
          callTool: async (_name: string, args: Record<string, unknown>) => {
            executed.push(args);
            return "completed";
          },
        };
        if (streaming) {
          expect(
            (await collect(runToolLoop(params))).some(
              (event) => event.type === "error"
            )
          ).toBe(true);
        } else {
          await expect(runToolLoopNonStreaming(params)).rejects.toThrow(
            /invalid.*arguments/i
          );
        }
        expect(executed).toEqual([]);
      }
    );
  }
);

it("does not dispatch an earlier Anthropic tool after a later invalid-JSON error", async () => {
  const events = [
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "call_1",
        name: "record_operation",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"target":"first"}' },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "call_2",
        name: "record_operation",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"target":' },
    },
    { type: "content_block_stop", index: 1 },
  ];
  vi.stubGlobal("fetch", async () => sseResponse(events));
  const executed: unknown[] = [];
  const output = await collect(
    runToolLoop({
      driver: createLlmDriver({
        provider: "anthropic",
        model: "test-model",
        apiKey: "test-key",
      }),
      messages: [...messages],
      tools: [],
      maxSteps: 1,
      callTool: async (_name, args) => {
        executed.push(args);
        return "completed";
      },
    })
  );
  expect(output.at(-1)).toMatchObject({ type: "error" });
  expect(executed).toEqual([]);
});

describe("Responses arguments-done events using the existing call_id format", () => {
  it.each(['{"target":', "null"])(
    "reports invalid arguments without a ready call: %s",
    async (args) => {
      const { streamResponsesTurn } =
        await import("../providers/openai-responses.js");
      vi.stubGlobal("fetch", async () =>
        sseResponse([
          {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "record_operation",
              arguments: "",
            },
          },
          {
            type: "response.function_call_arguments.done",
            call_id: "call_1",
            arguments: args,
          },
        ])
      );
      const output = await collect(
        streamResponsesTurn({
          config: {
            provider: "openai",
            model: "test-model",
            apiKey: "test-key",
          },
          input: [],
          tools: [],
        })
      );
      expect(output.at(-1)).toMatchObject({ type: "error" });
      expect(output.some((event) => event.type === "tool-call-ready")).toBe(
        false
      );
    }
  );
});
