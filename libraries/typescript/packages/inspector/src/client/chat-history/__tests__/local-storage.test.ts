import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalChatStorageProvider } from "../providers/local-storage";

const STORAGE_KEY = "mcp-inspector-chats";

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    store,
  };
}

describe("LocalChatStorageProvider", () => {
  let storage: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    storage = createStorageMock();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("crypto", {
      randomUUID: () => "chat-uuid-1",
    });
  });

  it("creates, lists, and deletes chats scoped by agent", async () => {
    const provider = new LocalChatStorageProvider();

    const created = await provider.createChat({
      agentId: "server-1",
      agentName: "My Server",
    });

    expect(created).toMatchObject({
      id: "chat-uuid-1",
      agent_id: "server-1",
      agent_name: "My Server",
      title: "New Chat",
    });

    const listed = await provider.listChats({ agentId: "server-1" });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.id).toBe("chat-uuid-1");

    const otherScope = await provider.listChats({ agentId: "server-2" });
    expect(otherScope.total).toBe(0);

    await provider.deleteChat("chat-uuid-1");
    const afterDelete = await provider.listChats({ agentId: "server-1" });
    expect(afterDelete.total).toBe(0);
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("adopts a caller-supplied id and reuses the chat it already stored", async () => {
    const provider = new LocalChatStorageProvider();

    const created = await provider.createChat({
      id: "session-1",
      agentId: "server-1",
    });
    expect(created.id).toBe("session-1");

    // Re-attaching after an OAuth redirect must not fork a duplicate row.
    const reattached = await provider.createChat({
      id: "session-1",
      agentId: "server-1",
    });
    expect(reattached.id).toBe("session-1");

    const listed = await provider.listChats({ agentId: "server-1" });
    expect(listed.total).toBe(1);
  });

  it("round-trips messages and auto-titles from first user message", async () => {
    vi.useFakeTimers();
    const provider = new LocalChatStorageProvider();

    const created = await provider.createChat({ agentId: "server-1" });
    const messages = [
      {
        id: "m1",
        role: "user" as const,
        content: "How do I list tools?",
        timestamp: Date.now(),
      },
    ];

    const savePromise = provider.saveMessages(created.id, messages);
    await vi.advanceTimersByTimeAsync(500);
    await savePromise;

    const loaded = await provider.getMessages(created.id);
    expect(loaded).toEqual(messages);

    const store = JSON.parse(storage.store.get(STORAGE_KEY) ?? "{}") as {
      sessions: Array<{ title: string }>;
    };
    expect(store.sessions[0]?.title).toBe("How do I list tools?");

    vi.useRealTimers();
  });

  it("paginates chat lists", async () => {
    const provider = new LocalChatStorageProvider();

    for (let i = 0; i < 3; i++) {
      vi.stubGlobal("crypto", {
        randomUUID: () => `chat-${i}`,
      });
      await provider.createChat({ agentId: "server-1" });
    }

    const page = await provider.listChats({
      agentId: "server-1",
      take: 2,
      skip: 0,
    });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });
});
