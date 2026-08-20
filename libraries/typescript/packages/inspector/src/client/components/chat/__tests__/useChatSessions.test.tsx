// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ChatSession,
  ChatStorageProvider,
  ListChatsParams,
} from "../../../chat-history/types";
import { savePendingChatTurn } from "../chat-auth-retry";
import type { ChatSessionState } from "../chat-session";
import { useChatSession, type ChatSessionUpdate } from "../chat-session-store";
import { useChatSessions, type ChatSessions } from "../useChatSessions";
import type { Message } from "../types";

const SERVER_ID = "https://example.test/mcp";
const AGENT_ID = "agent-1";

/** In-memory provider that adopts the caller's id, like the local provider. */
class FakeChatStorage implements ChatStorageProvider {
  readonly chats = new Map<string, ChatSession>();
  readonly messages = new Map<string, Message[]>();
  createChatCalls: (string | undefined)[] = [];

  async listChats(_params: ListChatsParams) {
    const items = [...this.chats.values()];
    return { items, total: items.length };
  }

  async getMessages(chatId: string) {
    return this.messages.get(chatId) ?? [];
  }

  async createChat(params: { id?: string; agentId: string; title?: string }) {
    this.createChatCalls.push(params.id);
    const existing = params.id ? this.chats.get(params.id) : undefined;
    if (existing) return existing;
    const id = params.id ?? `generated-${this.chats.size + 1}`;
    const chat: ChatSession = {
      id,
      title: params.title ?? "New Chat",
      agent_id: params.agentId,
      agent_name: "Fake",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    this.chats.set(id, chat);
    this.messages.set(id, []);
    return chat;
  }

  async updateChat(chatId: string) {
    return this.chats.get(chatId)!;
  }

  async deleteChat(chatId: string) {
    this.chats.delete(chatId);
  }

  async saveMessages(chatId: string, messages: Message[]) {
    this.messages.set(chatId, messages);
  }
}

/** Provider that mints its own ids, ignoring the session id it is handed. */
class BackendIdChatStorage extends FakeChatStorage {
  override async createChat(params: { id?: string; agentId: string }) {
    return super.createChat({
      ...params,
      id: `backend-${this.chats.size + 1}`,
    });
  }
}

interface Harness {
  sessions: ChatSessions;
  session: ChatSessionState;
  updateSession: (update: ChatSessionUpdate) => ChatSessionState;
}

function userMessage(text: string): Message {
  return { id: `user-${text}`, role: "user", content: text, timestamp: 1 };
}

function assistantMessage(text: string): Message {
  return {
    id: `assistant-${text}`,
    role: "assistant",
    content: text,
    timestamp: 2,
  };
}

function startTurn(current: Harness, text: string) {
  const { sessions, updateSession } = current;
  const sessionId = sessions.activeSessionId;
  const sent = updateSession((session) => ({
    isLoading: true,
    messages: [...session.messages, userMessage(text)],
  }));
  sessions.persistSessionMessages(sessionId, sent.messages);
  return {
    sessionId,
    finish(reply: string) {
      const done = updateSession((session) => ({
        isLoading: false,
        messages: [...session.messages, assistantMessage(reply)],
      }));
      sessions.persistSessionMessages(sessionId, done.messages);
    },
  };
}

describe("useChatSessions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let harness: Harness;

  function Probe(props: {
    storage: ChatStorageProvider | null;
    activeChatId?: string;
    onActiveChatIdChange?: (chatId: string | null) => void;
    initialMessages?: Message[];
  }) {
    const sessions = useChatSessions({
      retryServerId: SERVER_ID,
      agentId: AGENT_ID,
      storage: props.storage,
      activeChatId: props.activeChatId,
      onActiveChatIdChange: props.onActiveChatIdChange,
      initialMessages: props.initialMessages,
    });
    const [session, updateSession] = useChatSession(
      sessions.store,
      sessions.activeSessionId
    );
    harness = { sessions, session, updateSession };
    return null;
  }

  /** Host that owns `activeChatId`, as an embedder in controlled mode would. */
  function ControlledProbe({ storage }: { storage: ChatStorageProvider }) {
    const [activeChatId, setActiveChatId] = useState<string | undefined>(
      undefined
    );
    return (
      <Probe
        storage={storage}
        activeChatId={activeChatId}
        onActiveChatIdChange={(chatId) => setActiveChatId(chatId ?? undefined)}
      />
    );
  }

  async function render(element: React.ReactNode) {
    await act(async () => {
      root.render(element);
    });
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("persists a chat under the session id it was created with", async () => {
    const storage = new FakeChatStorage();
    await render(<Probe storage={storage} />);
    const sessionId = harness.sessions.activeSessionId;

    await act(async () => {
      startTurn(harness, "hello").finish("hi");
    });

    expect(storage.createChatCalls).toEqual([sessionId]);
    expect(storage.chats.has(sessionId)).toBe(true);
    expect(harness.sessions.activeChatId).toBe(sessionId);
    expect(storage.messages.get(sessionId)).toHaveLength(2);
  });

  it("starts a new chat while another session is still streaming", async () => {
    const storage = new FakeChatStorage();
    await render(<Probe storage={storage} />);

    let turn!: ReturnType<typeof startTurn>;
    await act(async () => {
      turn = startTurn(harness, "long running");
    });
    expect(harness.session.isLoading).toBe(true);

    await act(async () => {
      await harness.sessions.startNewChat();
    });

    const streaming = harness.sessions.store.get(turn.sessionId);
    expect(harness.sessions.activeSessionId).not.toBe(turn.sessionId);
    expect(streaming.isLoading).toBe(true);
    // The fresh chat is idle and empty, so it can be sent from immediately.
    expect(harness.session.isLoading).toBe(false);
    expect(harness.session.messages).toEqual([]);

    // The background turn finishes against the chat that started it.
    await act(async () => {
      turn.finish("done");
      startTurn(harness, "second chat");
    });

    expect(
      harness.sessions.store.get(turn.sessionId).messages.map((m) => m.content)
    ).toEqual(["long running", "done"]);
    expect(harness.session.messages.map((m) => m.content)).toEqual([
      "second chat",
    ]);
    expect(storage.messages.get(turn.sessionId)).toHaveLength(2);
  });

  it("keeps a live session's state when switching back to it", async () => {
    const storage = new FakeChatStorage();
    await render(<Probe storage={storage} />);

    let turn!: ReturnType<typeof startTurn>;
    await act(async () => {
      turn = startTurn(harness, "first");
    });
    await act(async () => {
      await harness.sessions.startNewChat();
    });
    await act(async () => {
      turn.finish("first reply");
    });

    const secondSessionId = harness.sessions.activeSessionId;
    await act(async () => {
      await harness.sessions.selectChat(turn.sessionId);
    });

    expect(harness.sessions.activeSessionId).toBe(turn.sessionId);
    expect(harness.session.messages.map((m) => m.content)).toEqual([
      "first",
      "first reply",
    ]);

    await act(async () => {
      await harness.sessions.selectChat(secondSessionId);
    });
    expect(harness.sessions.activeSessionId).toBe(secondSessionId);
    expect(harness.session.messages).toEqual([]);
  });

  it("does not overwrite an in-flight session with its persisted snapshot", async () => {
    const storage = new FakeChatStorage();
    await render(<Probe storage={storage} />);

    let turn!: ReturnType<typeof startTurn>;
    await act(async () => {
      turn = startTurn(harness, "streaming");
    });
    await act(async () => {
      await harness.sessions.startNewChat();
    });
    // Storage still holds only the user turn; the assistant reply is in memory.
    await act(async () => {
      harness.sessions.store.update(turn.sessionId, {
        messages: [
          ...harness.sessions.store.get(turn.sessionId).messages,
          assistantMessage("partial"),
        ],
      });
    });

    await act(async () => {
      await harness.sessions.selectChat(turn.sessionId);
    });

    expect(harness.session.isLoading).toBe(true);
    expect(harness.session.messages.map((m) => m.content)).toEqual([
      "streaming",
      "partial",
    ]);
  });

  it("keeps the new session when a controlled host clears the chat id", async () => {
    const storage = new FakeChatStorage();
    await render(<ControlledProbe storage={storage} />);

    await act(async () => {
      startTurn(harness, "first").finish("reply");
    });
    const firstSessionId = harness.sessions.activeSessionId;
    expect(harness.sessions.activeChatId).toBe(firstSessionId);

    await act(async () => {
      await harness.sessions.startNewChat();
    });

    // The host cleared and then re-set its id; the new session must stay active
    // rather than snapping back to the chat that was open before.
    expect(harness.sessions.activeSessionId).not.toBe(firstSessionId);
    expect(harness.sessions.activeChatId).toBe(
      harness.sessions.activeSessionId
    );
    expect(harness.session.messages).toEqual([]);
    expect(harness.session.isLoading).toBe(false);
  });

  it("applies controlled messages to the chat selected in the same render", async () => {
    const storage = new FakeChatStorage();
    const firstMessages = [userMessage("first")];
    const secondMessages = [userMessage("second")];

    await render(
      <Probe
        storage={storage}
        activeChatId="chat-1"
        initialMessages={firstMessages}
      />
    );
    await render(
      <Probe
        storage={storage}
        activeChatId="chat-2"
        initialMessages={secondMessages}
      />
    );

    expect(harness.sessions.activeSessionId).toBe("chat-2");
    expect(harness.session.messages).toEqual(secondMessages);
    expect(harness.sessions.store.get("chat-1").messages).toEqual(
      firstMessages
    );
  });

  it("reopens the session an OAuth redirect interrupted", async () => {
    const storage = new FakeChatStorage();
    const interrupted = "session-before-redirect";
    savePendingChatTurn({
      serverId: SERVER_ID,
      sessionId: interrupted,
      userInput: "read my profile",
      promptResults: [],
      attachments: [],
      baseMessages: [userMessage("read my profile")],
    });

    await render(<Probe storage={storage} />);

    expect(harness.sessions.activeSessionId).toBe(interrupted);
    expect(harness.session.messages.map((m) => m.content)).toEqual([
      "read my profile",
    ]);

    // Starting a new chat after the redirect must not reuse the restored id.
    await act(async () => {
      await harness.sessions.startNewChat();
    });
    expect(harness.sessions.activeSessionId).not.toBe(interrupted);
  });

  it("restores a backend-minted chat id after an OAuth redirect", async () => {
    const storage = new BackendIdChatStorage();
    await storage.createChat({ agentId: AGENT_ID });
    storage.createChatCalls = [];
    savePendingChatTurn({
      serverId: SERVER_ID,
      sessionId: "runtime-session",
      persistedChatId: "backend-1",
      userInput: "read my profile",
      promptResults: [],
      attachments: [],
      baseMessages: [userMessage("read my profile")],
    });

    await render(<Probe storage={storage} />);
    await act(async () => {
      harness.sessions.persistSessionMessages("runtime-session", [
        userMessage("resumed"),
      ]);
      await Promise.resolve();
    });

    expect(harness.sessions.activeSessionId).toBe("runtime-session");
    expect(harness.sessions.activeChatId).toBe("backend-1");
    expect(storage.createChatCalls).toEqual([]);
    expect(storage.messages.get("backend-1")?.map((m) => m.content)).toEqual([
      "resumed",
    ]);
  });

  it("resumes a controlled backend-minted chat using its runtime session", async () => {
    const storage = new BackendIdChatStorage();
    const restoredMessages = [userMessage("read my profile")];
    savePendingChatTurn({
      serverId: SERVER_ID,
      sessionId: "runtime-session",
      persistedChatId: "backend-1",
      userInput: "read my profile",
      promptResults: [],
      attachments: [],
      baseMessages: restoredMessages,
    });

    await render(
      <Probe storage={storage} activeChatId="backend-1" initialMessages={[]} />
    );

    expect(harness.sessions.activeSessionId).toBe("runtime-session");
    expect(harness.sessions.activeChatId).toBe("backend-1");
    expect(harness.session.messages).toEqual(restoredMessages);
    expect(harness.sessions.store.get("runtime-session").persistedChatId).toBe(
      "backend-1"
    );
  });

  it("reports a restored chat id to a callback-only controlled host", async () => {
    const storage = new BackendIdChatStorage();
    const reportedChatIds: (string | null)[] = [];
    savePendingChatTurn({
      serverId: SERVER_ID,
      sessionId: "runtime-session",
      persistedChatId: "backend-1",
      userInput: "read my profile",
      promptResults: [],
      attachments: [],
      baseMessages: [userMessage("read my profile")],
    });

    await render(
      <Probe
        storage={storage}
        onActiveChatIdChange={(chatId) => reportedChatIds.push(chatId)}
      />
    );

    expect(harness.sessions.activeSessionId).toBe("runtime-session");
    expect(reportedChatIds).toEqual(["backend-1"]);

    await render(
      <Probe
        storage={storage}
        onActiveChatIdChange={(chatId) => reportedChatIds.push(chatId)}
      />
    );
    expect(reportedChatIds).toEqual(["backend-1"]);
  });

  it("ignores a restored turn that belongs to another chat in controlled mode", async () => {
    const storage = new FakeChatStorage();
    savePendingChatTurn({
      serverId: SERVER_ID,
      sessionId: "some-other-session",
      userInput: "read my profile",
      promptResults: [],
      attachments: [],
      baseMessages: [userMessage("read my profile")],
    });

    await render(<Probe storage={storage} activeChatId="host-chat" />);

    expect(harness.sessions.activeSessionId).toBe("host-chat");
    expect(harness.session.messages).toEqual([]);
  });

  it("tracks a backend-minted chat id without losing the session", async () => {
    const storage = new BackendIdChatStorage();
    await render(<Probe storage={storage} />);
    const sessionId = harness.sessions.activeSessionId;

    await act(async () => {
      startTurn(harness, "hello").finish("hi");
    });

    const chatId = harness.sessions.activeChatId;
    expect(chatId).toBe("backend-1");
    expect(chatId).not.toBe(sessionId);
    expect(storage.messages.get("backend-1")).toHaveLength(2);

    await act(async () => {
      await harness.sessions.startNewChat();
    });
    await act(async () => {
      await harness.sessions.selectChat("backend-1");
    });

    expect(harness.sessions.activeSessionId).toBe(sessionId);
    expect(harness.session.messages).toHaveLength(2);
  });

  it("treats a controlled chat id as an existing persisted chat", async () => {
    const storage = new BackendIdChatStorage();
    await storage.createChat({ agentId: AGENT_ID });
    storage.createChatCalls = [];

    await render(
      <Probe
        storage={storage}
        activeChatId="backend-1"
        initialMessages={[userMessage("existing")]}
      />
    );

    await act(async () => {
      harness.sessions.persistSessionMessages("backend-1", [
        userMessage("updated"),
      ]);
      await Promise.resolve();
    });

    expect(storage.createChatCalls).toEqual([]);
    expect(storage.messages.get("backend-1")?.map((m) => m.content)).toEqual([
      "updated",
    ]);
  });

  it("creates one chat when a session is written to concurrently", async () => {
    const storage = new FakeChatStorage();
    await render(<Probe storage={storage} />);

    await act(async () => {
      const { sessions } = harness;
      sessions.persistSessionMessages(sessions.activeSessionId, [
        userMessage("a"),
      ]);
      sessions.persistSessionMessages(sessions.activeSessionId, [
        userMessage("a"),
        assistantMessage("b"),
      ]);
      await Promise.resolve();
    });

    expect(storage.createChatCalls).toHaveLength(1);
    expect(storage.chats.size).toBe(1);
  });

  it("persists an empty message list when clearing an existing chat", async () => {
    const storage = new FakeChatStorage();
    await render(<Probe storage={storage} />);

    await act(async () => {
      startTurn(harness, "hello").finish("hi");
    });
    const sessionId = harness.sessions.activeSessionId;
    expect(storage.messages.get(sessionId)).toHaveLength(2);

    await act(async () => {
      harness.sessions.persistSessionMessages(sessionId, []);
      await Promise.resolve();
    });

    expect(storage.messages.get(sessionId)).toEqual([]);
  });

  it("works without storage, giving each new chat its own session", async () => {
    await render(<Probe storage={null} />);
    const first = harness.sessions.activeSessionId;

    await act(async () => {
      startTurn(harness, "hello");
    });
    await act(async () => {
      await harness.sessions.startNewChat();
    });

    expect(harness.sessions.activeSessionId).not.toBe(first);
    expect(harness.sessions.activeChatId).toBeNull();
    expect(harness.session.messages).toEqual([]);
    expect(harness.sessions.store.get(first).isLoading).toBe(true);
  });
});
