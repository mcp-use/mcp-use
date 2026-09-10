import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChat } from "../chat.js";
import { createLlmDriver } from "../driver.js";
import type { LlmRequestError } from "../providers/openai-chat-completions.js";

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

  it("preserves OpenRouter request options and structured HTTP errors", async () => {
    const errorBody = {
      error: { message: "Insufficient credits" },
      loginRequired: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 402,
        statusText: "Payment Required",
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = completeChat({
      config: {
        provider: "openrouter",
        model: "anthropic/claude-fable-5",
        apiKey: "openrouter-key",
        temperature: 0.25,
        credentials: "include",
      },
      messages: [{ role: "user", content: "hello" }],
    });

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<LlmRequestError>>({
        name: "LlmRequestError",
        status: 402,
        body: errorBody,
      })
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toMatchObject({ temperature: 0.25 });
  });

  it("preserves request options and HTTP errors while streaming", async () => {
    const errorBody = { error: { message: "Rate limited" } };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 429,
        statusText: "Too Many Requests",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const driver = createLlmDriver({
      provider: "openrouter",
      model: "google/gemini-3.5-flash-lite",
      apiKey: "openrouter-key",
      temperature: 0.5,
      credentials: "include",
    });

    await expect(async () => {
      for await (const _event of driver.stream({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      })) {
        // HTTP errors terminate before yielding stream events.
      }
    }).rejects.toEqual(
      expect.objectContaining<Partial<LlmRequestError>>({
        name: "LlmRequestError",
        status: 429,
        body: errorBody,
      })
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toMatchObject({
      stream: true,
      temperature: 0.5,
    });
  });
});
