import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "../providers/index.js";

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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of streamChat({
      config: {
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4",
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

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      stream_options: { include_usage: true },
    });
  });
});
