import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, MINIMAX_ENDPOINTS, MINIMAX_MODELS } from "../providers/minimax";
import type { ProviderMessage } from "../types";

const imageToolMessages: ProviderMessage[] = [
  { role: "user", content: "Create an image." },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "generate-image", args: {} }],
  },
  {
    role: "tool",
    content: [
      {
        type: "image",
        data: "AAAA",
        mimeType: "image/png",
        url: "data:image/png;base64,AAAA",
      },
    ],
    toolCallId: "call_1",
    toolName: "generate-image",
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MiniMax provider", () => {
  it("exposes the configured model IDs and public endpoint presets", () => {
    expect(MINIMAX_MODELS).toEqual(["MiniMax-M3", "MiniMax-M2.7"]);
    expect(MINIMAX_ENDPOINTS.map((endpoint) => endpoint.region)).toEqual([
      "global_en",
      "cn_zh",
      "global_en",
      "cn_zh",
    ]);
    expect(MINIMAX_ENDPOINTS.map((endpoint) => endpoint.baseUrl)).toEqual([
      "https://api.minimax.io/v1",
      "https://api.minimaxi.com/v1",
      "https://api.minimax.io/anthropic",
      "https://api.minimaxi.com/anthropic",
    ]);
    expect(
      MINIMAX_ENDPOINTS.filter(
        (endpoint) => endpoint.protocol === "anthropic"
      ).every((endpoint) => endpoint.baseUrl.endsWith("/anthropic"))
    ).toBe(true);
  });

  for (const endpoint of MINIMAX_ENDPOINTS) {
    it(`sends image tool results through ${endpoint.label}`, async () => {
      const responseBody =
        endpoint.protocol === "anthropic"
          ? { content: [{ type: "text", text: "ok" }] }
          : { choices: [{ message: { content: "ok" } }] };
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
      );
      vi.stubGlobal("fetch", fetchMock);

      await chat({
        config: {
          provider: "minimax",
          model: MINIMAX_MODELS[0],
          apiKey: "test-key",
          baseUrl: endpoint.baseUrl,
        },
        messages: imageToolMessages,
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      const expectedPath =
        endpoint.protocol === "anthropic"
          ? "/v1/messages"
          : "/chat/completions";
      expect(url).toBe(`${endpoint.baseUrl}${expectedPath}`);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer test-key",
      });

      const body = JSON.parse(String(init?.body));
      if (endpoint.protocol === "anthropic") {
        const toolResult = body.messages
          .flatMap((message: { content?: unknown[] }) => message.content ?? [])
          .find((block: { type?: string }) => block.type === "tool_result");
        expect(toolResult.content).toContainEqual({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "AAAA",
          },
        });
      } else {
        const imagePart = body.messages
          .flatMap((message: { content?: unknown[] }) =>
            Array.isArray(message.content) ? message.content : []
          )
          .find((part: { type?: string }) => part.type === "image_url");
        expect(imagePart).toEqual({
          type: "image_url",
          image_url: { url: "data:image/png;base64,AAAA" },
        });
      }
    });
  }
});
