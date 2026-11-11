// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatMessages } from "../useChatMessages";
import type { StreamProtocol } from "../types";

describe("useChatMessages streaming failures", () => {
  let container: HTMLDivElement;
  let root: Root;
  let chat: ReturnType<typeof useChatMessages>;

  function Probe({ protocol }: { protocol: StreamProtocol }) {
    chat = useChatMessages({
      mcpServerUrl: "https://example.test/mcp",
      llmConfig: {
        provider: "openai",
        apiKey: "test-key",
        model: "test-model",
      },
      authConfig: null,
      isConnected: true,
      streamProtocol: protocol,
    });
    return null;
  }

  async function sendResponse(protocol: StreamProtocol, response: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(response))
    );
    await act(async () => root.render(<Probe protocol={protocol} />));
    await act(async () => chat.sendMessage("Hello", []));
    return chat.messages.filter((message) => message.role === "assistant");
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["data-stream", '3:"Provider rejected the tool schema"\n'],
    [
      "sse",
      'data: {"type":"error","message":"Provider rejected the tool schema"}\n\n',
    ],
  ] as const)(
    "shows %s provider errors instead of silently dropping them",
    async (protocol, response) => {
      const messages = await sendResponse(protocol, response);
      expect(messages.at(-1)?.content).toBe(
        "Error: Provider rejected the tool schema"
      );
      expect(chat.isLoading).toBe(false);
    }
  );

  it("explains an empty response that exhausted the output token limit", async () => {
    const messages = await sendResponse(
      "data-stream",
      'd:{"finishReason":"length"}\n'
    );
    expect(messages.at(-1)?.content).toContain("output token limit");
    expect(chat.isLoading).toBe(false);
  });

  it("preserves a partial answer when the output limit is reached", async () => {
    const messages = await sendResponse(
      "data-stream",
      '0:"Partial answer"\nd:{"finishReason":"length"}\n'
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Partial answer" },
    ]);
  });

  it("keeps reading valid events after a malformed JSON line", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const messages = await sendResponse(
      "sse",
      'data: invalid\ndata: {"type":"text","content":"hello"}\ndata: {"type":"done"}\n'
    );
    expect(messages[0]?.parts).toEqual([{ type: "text", text: "hello" }]);
  });
});
