import { describe, expect, it, vi } from "vitest";
import { ChatSessionStore } from "../chat-session-store";
import type { Message } from "../types";

function message(id: string): Message {
  return { id, role: "user", content: id, timestamp: 0 };
}

describe("ChatSessionStore", () => {
  it("keeps session state independent while preserving each runtime", () => {
    const store = new ChatSessionStore();
    const beforeA = store.get("a");
    const sessionB = store.get("b");
    const afterA = store.update("a", {
      isLoading: true,
      messages: [message("a1")],
    });

    expect(beforeA.messages).toEqual([]);
    expect(beforeA.isLoading).toBe(false);
    expect(afterA).not.toBe(beforeA);
    expect(afterA.runtime).toBe(beforeA.runtime);
    expect(afterA.runtime).not.toBe(sessionB.runtime);
    expect(sessionB.messages).toEqual([]);
    expect(sessionB.isLoading).toBe(false);
  });

  it("notifies only the subscribers of the session that changed", () => {
    const store = new ChatSessionStore();
    const onA = vi.fn();
    const onB = vi.fn();
    store.subscribe("a", onA);
    store.subscribe("b", onB);

    store.update("a", { isLoading: true });

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it("seeds only sessions it has not created yet", () => {
    const store = new ChatSessionStore();
    store.seed("a", [message("seed")]);
    expect(store.get("a").messages).toEqual([message("seed")]);

    store.seed("a", [message("later")]);
    expect(store.get("a").messages).toEqual([message("seed")]);
  });

  it("finds a session by its persisted chat id, falling back to its own id", () => {
    const store = new ChatSessionStore();
    store.get("same-id");
    store.update("runtime-id", { persistedChatId: "backend-id" });

    expect(store.findByPersistedChatId("same-id")?.id).toBe("same-id");
    expect(store.findByPersistedChatId("backend-id")?.id).toBe("runtime-id");
    expect(store.findByPersistedChatId("runtime-id")).toBeUndefined();
    expect(store.findByPersistedChatId("missing")).toBeUndefined();
  });
});
