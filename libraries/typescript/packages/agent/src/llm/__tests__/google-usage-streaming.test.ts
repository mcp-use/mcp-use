import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChat } from "../providers/index.js";

describe("Google streamed usage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([80, 0])("preserves %i cached input tokens", async (cachedTokens) => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: "hello" }] } }] },
      {
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 10,
          cachedContentTokenCount: cachedTokens,
          thoughtsTokenCount: 5,
          totalTokenCount: 115,
        },
      },
    ];
    const sse = chunks
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
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
      config: { provider: "google", model: "gemini-test", apiKey: "test-key" },
      messages: [{ role: "user", content: "hello" }],
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "text-delta", delta: "hello" });
    expect(events.find((event) => event.type === "usage")).toMatchObject({
      type: "usage",
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: cachedTokens,
        reasoningTokens: 5,
        totalTokens: 115,
      },
    });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
