import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmRequestError } from "../providers/openai-chat-completions.js";

describe("openai-chat-completions credentials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards credentials to fetch and preserves 429 JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "rate_limited",
          loginRequired: true,
          loginUrl: "https://manufact.com/login",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { streamChat } =
      await import("../providers/openai-chat-completions.js");

    await expect(async () => {
      for await (const _event of streamChat({
        config: {
          provider: "openai-compatible",
          model: "test-model",
          apiKey: "server-managed",
          baseUrl: "http://localhost:8000/api/v1/inspector/llm",
          credentials: "include",
        },
        messages: [{ role: "user", content: "hi" }],
      })) {
        // should not stream on HTTP error
      }
    }).rejects.toMatchObject({
      status: 429,
      body: {
        loginRequired: true,
        loginUrl: "https://manufact.com/login",
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });
});
