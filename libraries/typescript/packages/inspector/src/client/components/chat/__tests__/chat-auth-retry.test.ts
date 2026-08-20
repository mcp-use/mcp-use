import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingChatTurn,
  readPendingChatTurn,
  readPendingChatTurnForServer,
  savePendingChatTurn,
} from "../chat-auth-retry";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function turn(serverId: string, sessionId: string) {
  return {
    serverId,
    sessionId,
    userInput: "Read my profile",
    promptResults: [],
    attachments: [],
    baseMessages: [
      {
        id: "user-1",
        role: "user" as const,
        content: "Read my profile",
        timestamp: 1,
      },
    ],
  };
}

describe("chat auth retry storage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("round-trips a pending turn for the matching server and session", () => {
    const storage = createStorage();
    const pending = turn("server-1", "session-1");

    savePendingChatTurn(pending, storage);

    expect(readPendingChatTurn("server-1", "session-1", storage)).toMatchObject(
      pending
    );
    expect(readPendingChatTurn("server-2", "session-1", storage)).toBeNull();
    expect(readPendingChatTurn("server-1", "session-2", storage)).toBeNull();
  });

  it("keeps concurrent chats' turns apart", () => {
    const storage = createStorage();
    savePendingChatTurn(turn("server-1", "session-1"), storage);
    savePendingChatTurn(turn("server-1", "session-2"), storage);

    // Authorizing the second chat must not discard the first chat's turn.
    expect(
      readPendingChatTurn("server-1", "session-1", storage)
    ).not.toBeNull();

    clearPendingChatTurn("server-1", "session-2", storage);

    expect(
      readPendingChatTurn("server-1", "session-1", storage)
    ).not.toBeNull();
    expect(readPendingChatTurn("server-1", "session-2", storage)).toBeNull();
  });

  it("reports which session the redirect interrupted", () => {
    const storage = createStorage();
    savePendingChatTurn(turn("server-1", "session-1"), storage);
    savePendingChatTurn(turn("server-1", "session-2"), storage);

    expect(readPendingChatTurnForServer("server-1", storage)?.sessionId).toBe(
      "session-2"
    );

    clearPendingChatTurn("server-1", "session-2", storage);

    // The pointer is cleared with the turn it named, so a stale session id
    // cannot resurface in a chat the user starts later.
    expect(readPendingChatTurnForServer("server-1", storage)).toBeNull();
  });

  it("drops expired and explicitly cleared turns", () => {
    const storage = createStorage();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    savePendingChatTurn(turn("server-1", "session-1"), storage);

    vi.spyOn(Date, "now").mockReturnValue(16 * 60_000);
    expect(readPendingChatTurn("server-1", "session-1", storage)).toBeNull();
    expect(readPendingChatTurnForServer("server-1", storage)).toBeNull();

    vi.spyOn(Date, "now").mockReturnValue(20 * 60_000);
    savePendingChatTurn(turn("server-1", "session-1"), storage);
    clearPendingChatTurn("server-1", "session-1", storage);
    expect(readPendingChatTurn("server-1", "session-1", storage)).toBeNull();
  });
});
