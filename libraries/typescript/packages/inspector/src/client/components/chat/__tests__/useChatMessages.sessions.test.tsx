// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatMessages } from "../useChatMessages";
import { useChatSessions, type ChatSessions } from "../useChatSessions";

interface Harness {
  sessions: ChatSessions;
  chat: ReturnType<typeof useChatMessages>;
}

describe("useChatMessages session isolation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let harness: Harness;
  let streams: ReadableStreamDefaultController<Uint8Array>[];

  function Probe() {
    const sessions = useChatSessions({
      retryServerId: "server-1",
      agentId: "server-1",
      storage: null,
    });
    const chat = useChatMessages({
      sessionStore: sessions.store,
      sessionId: sessions.activeSessionId,
      onMessagesChange: sessions.persistSessionMessages,
      mcpServerUrl: "https://example.test/mcp",
      llmConfig: {
        provider: "openai",
        apiKey: "test-key",
        model: "test-model",
      },
      authConfig: null,
      isConnected: true,
      chatApiUrl: "https://example.test/chat",
    });
    harness = { sessions, chat };
    return null;
  }

  async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
  }

  function finishStream(
    controller: ReadableStreamDefaultController<Uint8Array>,
    text: string
  ) {
    const encoder = new TextEncoder();
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ type: "text", content: text })}\n\n`
      )
    );
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
    );
    controller.close();
  }

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    streams = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
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

  it("lets a new session send while the previous session keeps streaming", async () => {
    const firstSessionId = harness.sessions.activeSessionId;
    let firstSend!: Promise<void>;
    await act(async () => {
      firstSend = harness.chat.sendMessage("first", []);
      await flushAsyncWork();
    });

    expect(harness.chat.isLoading).toBe(true);
    expect(streams).toHaveLength(1);

    await act(async () => {
      await harness.sessions.startNewChat();
    });
    const secondSessionId = harness.sessions.activeSessionId;
    expect(secondSessionId).not.toBe(firstSessionId);
    expect(harness.chat.isLoading).toBe(false);

    let secondSend!: Promise<void>;
    await act(async () => {
      secondSend = harness.chat.sendMessage("second", []);
      await flushAsyncWork();
    });

    expect(streams).toHaveLength(2);
    expect(harness.sessions.store.get(firstSessionId).isLoading).toBe(true);
    expect(harness.chat.isLoading).toBe(true);

    await act(async () => {
      finishStream(streams[1]!, "second reply");
      await secondSend;
      finishStream(streams[0]!, "first reply");
      await firstSend;
    });

    expect(harness.sessions.activeSessionId).toBe(secondSessionId);
    expect(harness.chat.isLoading).toBe(false);
    expect(
      harness.sessions.store
        .get(firstSessionId)
        .messages.map((message) => message.content)
    ).toEqual(["first", ""]);
    expect(
      harness.sessions.store
        .get(secondSessionId)
        .messages.map((message) => message.content)
    ).toEqual(["second", ""]);
    expect(
      harness.sessions.store.get(firstSessionId).messages[1]?.parts?.[0]
    ).toMatchObject({ type: "text", text: "first reply" });
    expect(
      harness.sessions.store.get(secondSessionId).messages[1]?.parts?.[0]
    ).toMatchObject({ type: "text", text: "second reply" });
  });
});
