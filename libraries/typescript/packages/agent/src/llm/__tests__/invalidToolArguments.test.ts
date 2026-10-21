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
  args: string | unknown[],
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
        [
          '{"target":"requested"',
          "null",
          "[]",
          false,
          0,
          true,
          42,
          null,
          undefined,
          {},
          [],
        ].map((args) => [streaming, args] as const)
      )
    )(
      "does not execute invalid arguments (streaming=%s, args=%s)",
      async (streaming, rawArguments) => {
        vi.stubGlobal("fetch", async () =>
          providerReply(provider, [rawArguments], streaming)
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
    it.each(
      [false, true].flatMap((streaming) =>
        ['{"target":', false].map((args) => [streaming, args] as const)
      )
    )(
      "validates the whole turn before dispatch (streaming=%s, args=%s)",
      async (streaming, args) => {
        vi.stubGlobal("fetch", async () =>
          providerReply(provider, ['{"target":"first"}', args], streaming)
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

describe("Responses arguments-done events using item_id correlation", () => {
  it.each(
    ['{"target":', "null", false, 0, null, undefined, {}, []].map((args) => ({
      args,
    }))
  )(
    "reports invalid arguments without a ready call: $args",
    async ({ args }) => {
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
            type: "response.function_call_arguments.delta",
            item_id: "fc_1",
            delta: '{"target":"buffered"}',
          },
          {
            type: "response.function_call_arguments.done",
            item_id: "fc_1",
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

it("preserves split Chat Completions arguments after a name-only chunk", async () => {
  vi.stubGlobal("fetch", async () =>
    sseResponse([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "record_operation" },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"target":' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"requested"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ])
  );
  const executed: unknown[] = [];
  const output = await collect(
    runToolLoop({
      driver: createLlmDriver({
        provider: "openai-compatible",
        model: "test-model",
        apiKey: "test-key",
        baseUrl: "https://model.example/v1",
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
  expect(output.some((event) => event.type === "error")).toBe(false);
  expect(executed).toEqual([{ target: "requested" }]);
});

it.each([false, true])(
  "rejects a non-string Chat chunk even with valid chunks (invalid first=%s)",
  async (invalidFirst) => {
    const parts = invalidFirst
      ? [false, '{"target":"requested"}']
      : ['{"target":"requested"}', false];
    vi.stubGlobal("fetch", async () =>
      sseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "record_operation" },
                  },
                ],
              },
            },
          ],
        },
        ...parts.map((argumentsChunk) => ({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: argumentsChunk } },
                ],
              },
            },
          ],
        })),
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      ])
    );
    const executed: unknown[] = [];
    const output = await collect(
      runToolLoop({
        driver: createLlmDriver({
          provider: "openai-compatible",
          model: "test-model",
          apiKey: "test-key",
          baseUrl: "https://model.example/v1",
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
  }
);

it.each([
  { delta: "", done: "", expected: {} },
  {
    delta: '{"target":"buffered"}',
    done: "",
    expected: { target: "buffered" },
  },
  {
    delta: '{"target":"buffered"}',
    done: '{"target":"completed"}',
    expected: { target: "completed" },
  },
])(
  "preserves valid Responses done arguments: $done (buffer=$delta)",
  async ({ delta, done, expected }) => {
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
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          delta,
        },
        {
          type: "response.function_call_arguments.done",
          item_id: "fc_1",
          arguments: done,
        },
      ])
    );
    const output = await collect(
      streamResponsesTurn({
        config: { provider: "openai", model: "test-model", apiKey: "test-key" },
        input: [],
        tools: [],
      })
    );
    expect(output.some((event) => event.type === "error")).toBe(false);
    expect(output.filter((event) => event.type === "tool-call-ready")).toEqual([
      {
        type: "tool-call-ready",
        index: 0,
        toolCallId: "call_1",
        toolName: "record_operation",
        args: expected,
      },
    ]);
  }
);

describe("Chat Completions streams without a tool finish reason", () => {
  it.each(
    [false, true].flatMap((doneMarker) =>
      ['{"target":', '{"target":"requested"}', "", undefined, null, false].map(
        (args) => ({ doneMarker, args })
      )
    )
  )(
    "rejects unfinished tool calls (DONE=$doneMarker, args=$args)",
    async ({ doneMarker, args }) => {
      const event = {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: { name: "record_operation", arguments: args },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      vi.stubGlobal(
        "fetch",
        async () =>
          new Response(
            `data: ${JSON.stringify(event)}\n\n` +
              (doneMarker ? "data: [DONE]\n\n" : ""),
            { headers: { "Content-Type": "text/event-stream" } }
          )
      );
      const executed: unknown[] = [];
      const output = await collect(
        runToolLoop({
          driver: createLlmDriver({
            provider: "openai-compatible",
            model: "test-model",
            apiKey: "test-key",
            baseUrl: "https://model.example/v1",
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
      expect(
        output.some(
          (event) =>
            event.type === "done" ||
            event.type === "tool-call-ready" ||
            event.type === "tool-result"
        )
      ).toBe(false);
      expect(executed).toEqual([]);
    }
  );

  it.each([false, true])(
    "preserves text-only streams (finish reason=%s)",
    async (finished) => {
      vi.stubGlobal("fetch", async () =>
        sseResponse([
          {
            choices: [
              {
                delta: { content: "A plain answer" },
                finish_reason: finished ? "stop" : null,
              },
            ],
          },
        ])
      );
      const executed: unknown[] = [];
      const output = await collect(
        runToolLoop({
          driver: createLlmDriver({
            provider: "openai-compatible",
            model: "test-model",
            apiKey: "test-key",
            baseUrl: "https://model.example/v1",
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
      expect(output).toEqual([
        { type: "text-delta", delta: "A plain answer" },
        { type: "done" },
      ]);
      expect(executed).toEqual([]);
    }
  );
});

it("does not report an unfinished-call error for caller cancellation", async () => {
  vi.stubGlobal("fetch", async () =>
    sseResponse([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: {
                    name: "record_operation",
                    arguments: '{"target":',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
    ])
  );
  const controller = new AbortController();
  const executed: unknown[] = [];
  const stream = runToolLoop({
    driver: createLlmDriver({
      provider: "openai-compatible",
      model: "test-model",
      apiKey: "test-key",
      baseUrl: "https://model.example/v1",
    }),
    messages: [...messages],
    tools: [],
    maxSteps: 1,
    signal: controller.signal,
    callTool: async (_name, args) => {
      executed.push(args);
      return "completed";
    },
  });
  expect((await stream.next()).value).toMatchObject({
    type: "tool-call-start",
  });
  controller.abort();
  const remaining = await collect(stream);
  expect(
    remaining.some(
      (event) =>
        event.type === "error" ||
        event.type === "tool-call-ready" ||
        event.type === "tool-result"
    )
  ).toBe(false);
  expect(executed).toEqual([]);
});
