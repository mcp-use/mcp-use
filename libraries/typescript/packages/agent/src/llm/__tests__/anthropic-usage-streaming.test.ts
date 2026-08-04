import { describe, expect, it, vi, afterEach } from "vitest";

import { streamChat } from "../providers/anthropic.js";

describe("Anthropic streamed usage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the message_start counters and bills the cache", async () => {
    // The real event sequence. message_start carries the input side including both cache
    // counters; message_delta carries output_tokens and nothing else.
    const sse = [
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 3,
            cache_read_input_tokens: 20000,
            cache_creation_input_tokens: 1500,
            output_tokens: 1,
          },
        },
      },
      { type: "message_delta", usage: { output_tokens: 120 } },
      { type: "message_stop" },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
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
        provider: "anthropic",
        model: "claude-test",
        apiKey: "test-key",
      },
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(event);
    }

    const usageEvent = events.find((e) => e.type === "usage");
    expect(usageEvent).toBeDefined();
    expect(usageEvent).toMatchObject({
      type: "usage",
      usage: {
        inputTokens: 3,
        cachedInputTokens: 20000,
        cacheCreationInputTokens: 1500,
        outputTokens: 120,
        // 3 + 20000 + 1500 + 120. Before this change the input side was undefined by the
        // time message_stop ran, and the total was 123.
        totalTokens: 21623,
      },
    });
  });
});
