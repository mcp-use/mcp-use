import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chat,
  streamChat,
} from "../providers/openai-chat-completions.js";
import { buildEndpoint } from "../providers/openai-shared.js";

/**
 * `baseUrl` is user configuration, and a trailing slash is both common
 * (`http://localhost:8000/v1/`) and tolerated by every other base-URL consumer
 * in this package (`normalizeOllamaBaseUrl`, the Responses driver). The
 * chat-completions provider must build the same URL for both spellings.
 */
const BASE_WITHOUT_SLASH = "http://localhost:8000/v1";
const BASE_WITH_SLASH = `${BASE_WITHOUT_SLASH}/`;

function fetchUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const [input] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
  return String(input);
}

function stubJsonFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("openai-chat-completions endpoint building", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not add a second slash for a base URL that ends with one", async () => {
    const fetchMock = stubJsonFetch();

    const result = await chat({
      config: {
        provider: "openai-compatible",
        model: "local-model",
        apiKey: "local",
        baseUrl: BASE_WITH_SLASH,
      },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.text).toBe("ok");
    expect(fetchUrl(fetchMock)).toBe(`${BASE_WITHOUT_SLASH}/chat/completions`);
  });

  it("keeps a base URL without a trailing slash unchanged", async () => {
    const fetchMock = stubJsonFetch();

    await chat({
      config: {
        provider: "openai-compatible",
        model: "local-model",
        apiKey: "local",
        baseUrl: BASE_WITHOUT_SLASH,
      },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchUrl(fetchMock)).toBe(`${BASE_WITHOUT_SLASH}/chat/completions`);
  });

  it("normalizes streaming requests the same way", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const events: unknown[] = [];
    for await (const event of streamChat({
      config: {
        provider: "openai-compatible",
        model: "local-model",
        apiKey: "local",
        baseUrl: BASE_WITH_SLASH,
      },
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: "done" });
    expect(fetchUrl(fetchMock)).toBe(`${BASE_WITHOUT_SLASH}/chat/completions`);
  });

  it("collapses repeated trailing slashes in the shared helper", () => {
    expect(
      buildEndpoint(
        {
          provider: "openai",
          model: "gpt-4o",
          apiKey: "k",
          baseUrl: `${BASE_WITHOUT_SLASH}///`,
        },
        "/responses"
      )
    ).toBe(`${BASE_WITHOUT_SLASH}/responses`);
  });
});
