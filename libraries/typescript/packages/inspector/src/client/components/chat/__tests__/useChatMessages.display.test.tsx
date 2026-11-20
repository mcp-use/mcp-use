// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatMessages } from "../useChatMessages";
import { useChatSessions } from "../useChatSessions";

describe("useChatMessages model-only content", () => {
  let container: HTMLDivElement;
  let root: Root;
  let chat: ReturnType<typeof useChatMessages>;
  let requestBodies: unknown[];

  function Probe() {
    const sessions = useChatSessions({
      retryServerId: "server-1",
      agentId: "server-1",
      storage: null,
    });
    chat = useChatMessages({
      sessionStore: sessions.store,
      sessionId: sessions.activeSessionId,
      onMessagesChange: sessions.persistSessionMessages,
      mcpServerUrl: "https://example.test/mcp",
      llmConfig: { provider: "openai", apiKey: "test-key", model: "m" },
      authConfig: null,
      isConnected: true,
      chatApiUrl: "https://example.test/chat",
    });
    return null;
  }

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    requestBodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
            );
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("stores the display text but sends the full text to the model", async () => {
    await act(async () => {
      await chat.sendMessage("Visible.\nHidden context.", [], undefined, {
        displayContent: "Visible.",
      });
    });

    expect(chat.messages[0]).toMatchObject({
      role: "user",
      content: "Visible.\nHidden context.",
      displayContent: "Visible.",
    });
    const body = requestBodies[0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: "Visible.\nHidden context.",
      })
    );
  });

  it("leaves displayContent unset for ordinary messages", async () => {
    await act(async () => {
      await chat.sendMessage("Hello", []);
    });
    expect(chat.messages[0]).not.toHaveProperty("displayContent");
  });
});
