import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmDriver } from "../driver.js";
import { runNativeAgent, streamNativeAgentSteps } from "../native_runner.js";
import { OpenAIResponsesDriver } from "../providers/openai-responses-driver.js";

// A `Response` whose body streams the given Responses events as SSE.
function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, { status: 200 });
}

// The model writes a short preamble and calls a tool, then answers.
function preambleThenAnswerDriver(): LlmDriver {
  let turn = 0;
  return {
    async *stream() {
      turn += 1;
      if (turn === 1) {
        yield { type: "text-delta", delta: "Let me check the files." };
        yield {
          type: "tool-call-start",
          index: 0,
          toolCallId: "call_a",
          toolName: "list_files",
        };
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

// Drain a generator and resolve with its return value.
async function returnValue<T>(
  generator: AsyncGenerator<unknown, T, void>
): Promise<T> {
  let next = await generator.next();
  while (!next.done) {
    next = await generator.next();
  }
  return next.value;
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

    await expect(
      returnValue(streamNativeAgentSteps(preambleThenAnswerDriver(), options))
    ).resolves.toBe("The folder has a.ts.");
    await expect(
      runNativeAgent(preambleThenAnswerDriver(), options)
    ).resolves.toBe("The folder has a.ts.");
  });

  it("returns an empty string when maxSteps ends the run after tool results, like runNativeAgent", async () => {
    const options = {
      messages: [],
      tools: [],
      callTool: vi.fn().mockResolvedValue("a.ts"),
      maxSteps: 1,
    };

    await expect(
      returnValue(streamNativeAgentSteps(preambleThenAnswerDriver(), options))
    ).resolves.toBe("");
    await expect(
      runNativeAgent(preambleThenAnswerDriver(), options)
    ).resolves.toBe("");
  });

  it("returns an empty string when aborted before the requested tool runs, like runNativeAgent", async () => {
    const callTool = vi.fn().mockResolvedValue("a.ts");

    // Streaming: abort once the tool call is announced, before it runs.
    const streaming = new AbortController();
    const steps = streamNativeAgentSteps(preambleThenAnswerDriver(), {
      messages: [],
      tools: [],
      callTool,
      signal: streaming.signal,
    });
    expect((await steps.next()).done).toBe(false);
    streaming.abort();
    await expect(returnValue(steps)).resolves.toBe("");

    // Non-streaming: abort while the tool-call turn is being generated.
    const nonStreaming = new AbortController();
    const driver = preambleThenAnswerDriver();
    const complete = driver.complete.bind(driver);
    driver.complete = async (params) => {
      const turn = await complete(params);
      nonStreaming.abort();
      return turn;
    };
    await expect(
      runNativeAgent(driver, {
        messages: [],
        tools: [],
        callTool,
        signal: nonStreaming.signal,
      })
    ).resolves.toBe("");

    expect(callTool).not.toHaveBeenCalled();
  });

  describe("with the OpenAI Responses driver", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("returns only the final turn's text", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            sseResponse([
              {
                type: "response.output_text.delta",
                delta: "Let me check the files.",
              },
              {
                type: "response.output_item.added",
                output_index: 1,
                item: {
                  type: "function_call",
                  id: "fc_a",
                  call_id: "call_a",
                  name: "list_files",
                  arguments: "",
                },
              },
              {
                type: "response.function_call_arguments.done",
                item_id: "fc_a",
                output_index: 1,
                arguments: "{}",
              },
              {
                type: "response.completed",
                response: {
                  output: [
                    {
                      type: "message",
                      role: "assistant",
                      content: [
                        {
                          type: "output_text",
                          text: "Let me check the files.",
                        },
                      ],
                    },
                    {
                      type: "function_call",
                      id: "fc_a",
                      call_id: "call_a",
                      name: "list_files",
                      arguments: "{}",
                    },
                  ],
                },
              },
            ])
          )
          .mockResolvedValueOnce(
            sseResponse([
              {
                type: "response.output_text.delta",
                delta: "The folder has a.ts.",
              },
              { type: "response.completed", response: { output: [] } },
            ])
          )
      );

      const driver = new OpenAIResponsesDriver({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "k",
      });

      await expect(
        returnValue(
          streamNativeAgentSteps(driver, {
            messages: [{ role: "user", content: "What's in the folder?" }],
            tools: [{ name: "list_files", inputSchema: { type: "object" } }],
            callTool: vi.fn().mockResolvedValue("a.ts"),
          })
        )
      ).resolves.toBe("The folder has a.ts.");
    });
  });
});
