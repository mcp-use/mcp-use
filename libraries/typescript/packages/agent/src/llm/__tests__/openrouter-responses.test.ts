import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat } from "../chat.js";

describe("OpenRouter Responses transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "openai/gpt-5.6-terra",
    "anthropic/claude-fable-5",
    "google/gemini-3.5-flash-lite",
  ])("uses /responses for every model slug (%s)", async (model) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output_text: "ok",
          output: [],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await completeChat({
      config: { provider: "openrouter", model, apiKey: "openrouter-key" },
      messages: [{ role: "user", content: "hello" }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/responses");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer openrouter-key",
      "HTTP-Referer": "https://inspector.mcp-use.com",
      "X-Title": "mcp-use Inspector",
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model,
      stream: false,
    });
  });
});
