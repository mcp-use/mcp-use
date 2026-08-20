// @vitest-environment jsdom
import type { McpServer } from "@mcp-use/client/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPendingChatTurn } from "../chat-auth-retry";
import { useChatMessagesClientSide } from "../useChatMessagesClientSide";
import { useChatSessions, type ChatSessions } from "../useChatSessions";

const SERVER_ID = "server-1";

interface Harness {
  sessions: ChatSessions;
  chat: ReturnType<typeof useChatMessagesClientSide>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("useChatMessagesClientSide authentication", () => {
  let container: HTMLDivElement;
  let root: Root;
  let harness: Harness;
  let authenticate: ReturnType<typeof vi.fn>;
  let connection: McpServer;

  function Probe() {
    const sessions = useChatSessions({
      retryServerId: SERVER_ID,
      agentId: SERVER_ID,
      storage: null,
    });
    const chat = useChatMessagesClientSide({
      sessionStore: sessions.store,
      sessionId: sessions.activeSessionId,
      onMessagesChange: sessions.persistSessionMessages,
      connection,
      llmConfig: {
        provider: "openai",
        apiKey: "test-key",
        model: "test-model",
      },
      isConnected: true,
    });
    harness = { sessions, chat };
    return null;
  }

  function prepareAuthorization(creation: Promise<string | null>) {
    const sessionId = harness.sessions.activeSessionId;
    harness.sessions.store.update(sessionId, {
      creation,
      pendingAuthorization: {
        toolCallId: "tool-1",
        replay: {
          serverId: SERVER_ID,
          sessionId,
          userInput: "read my profile",
          promptResults: [],
          attachments: [],
          baseMessages: [],
        },
      },
    });
    return sessionId;
  }

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    authenticate = vi.fn(async () => undefined);
    connection = {
      id: SERVER_ID,
      url: "https://example.test/mcp",
      authenticate,
    } as unknown as McpServer;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Probe />));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => root.unmount());
    container.remove();
  });

  it("authenticates once while chat creation is still resolving", async () => {
    const creation = deferred<string | null>();
    let sessionId = "";
    await act(async () => {
      sessionId = prepareAuthorization(creation.promise);
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = harness.chat.authenticatePendingTool("tool-1");
      second = harness.chat.authenticatePendingTool("tool-1");
      await Promise.resolve();
    });

    expect(authenticate).not.toHaveBeenCalled();
    expect(harness.sessions.store.get(sessionId).authenticatingToolCallId).toBe(
      "tool-1"
    );

    await act(async () => {
      creation.resolve("backend-1");
      await Promise.all([first, second]);
    });

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(readPendingChatTurn(SERVER_ID, sessionId)?.persistedChatId).toBe(
      "backend-1"
    );
    expect(
      harness.sessions.store.get(sessionId).authenticatingToolCallId
    ).toBeNull();
  });

  it("does not let stalled chat history block authentication", async () => {
    vi.useFakeTimers();
    const creation = deferred<string | null>();
    await act(async () => {
      prepareAuthorization(creation.promise);
    });

    let authentication!: Promise<void>;
    await act(async () => {
      authentication = harness.chat.authenticatePendingTool("tool-1");
      await vi.runAllTimersAsync();
      await authentication;
    });

    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});
