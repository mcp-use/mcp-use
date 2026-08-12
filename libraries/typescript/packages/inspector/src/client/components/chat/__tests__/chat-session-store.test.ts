import { describe, expect, it, vi } from "vitest";
import { ChatSessionStore } from "../chat-session-store";
import type { Message } from "../types";

function message(id: string): Message {
  return { id, role: "user", content: id, timestamp: 0 };
}

describe("ChatSessionStore", () => {
  it("creates an empty record on first access", () => {
    const store = new ChatSessionStore();
    expect(store.has("a")).toBe(false);

    const session = store.get("a");
    expect(session.id).toBe("a");
    expect(session.messages).toEqual([]);
    expect(session.isLoading).toBe(false);
    expect(store.has("a")).toBe(true);
    expect(store.get("a")).toBe(session);
  });

  it("keeps each session's state independent", () => {
    const store = new ChatSessionStore();
    store.update("a", { isLoading: true, messages: [message("a1")] });
    store.update("b", { messages: [message("b1")] });

    expect(store.get("a").isLoading).toBe(true);
    expect(store.get("b").isLoading).toBe(false);
    expect(store.get("b").messages).toEqual([message("b1")]);
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

  it("skips notifying when a patch changes nothing", () => {
    const store = new ChatSessionStore();
    const messages = [message("a1")];
    store.update("a", { messages });
    const listener = vi.fn();
    store.subscribe("a", listener);

    const unchanged = store.update("a", { messages });

    expect(listener).not.toHaveBeenCalled();
    expect(unchanged).toBe(store.get("a"));
  });

  it("gives every update a new snapshot but one stable runtime", () => {
    const store = new ChatSessionStore();
    const before = store.get("a");
    const after = store.update("a", { isLoading: true });

    expect(after).not.toBe(before);
    expect(after.runtime).toBe(before.runtime);
  });

  it("seeds only sessions it has not created yet", () => {
    const store = new ChatSessionStore();
    store.seed("a", [message("seed")]);
    expect(store.get("a").messages).toEqual([message("seed")]);

    store.seed("a", [message("later")]);
    expect(store.get("a").messages).toEqual([message("seed")]);
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = new ChatSessionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe("a", listener);
    unsubscribe();

    store.update("a", { isLoading: true });

    expect(listener).not.toHaveBeenCalled();
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

  it("drops a deleted session", () => {
    const store = new ChatSessionStore();
    store.update("a", { messages: [message("a1")] });
    store.delete("a");

    expect(store.has("a")).toBe(false);
    expect(store.get("a").messages).toEqual([]);
  });
});
