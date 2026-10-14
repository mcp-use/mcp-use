import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "../providers/openai-chat-completions.js";

describe("OpenAI Chat Completions streamed usage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves cache and reasoning counters from the final usage chunk", async () => {
    const chunks = [
      { choices: [{ delta: { content: "hello" }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      },
    ];
    const sse =
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
      "data: [DONE]\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      )
    );

    const events = [];
    for await (const event of streamChat({
      config: {
        provider: "openai",
        model: "test-model",
        apiKey: "test-key",
      },
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(event);
    }

    expect(events.find((event) => event.type === "usage")).toMatchObject({
      type: "usage",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
        cachedInputTokens: 3,
        reasoningTokens: 2,
      },
    });
  });
});
