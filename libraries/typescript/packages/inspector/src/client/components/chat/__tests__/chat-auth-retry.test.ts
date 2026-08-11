import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingChatTurn,
  readPendingChatTurn,
  savePendingChatTurn,
} from "../chat-auth-retry";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("chat auth retry storage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("round-trips a pending chat turn for the matching server", () => {
    const storage = createStorage();
    const turn = {
      serverId: "server-1",
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

    savePendingChatTurn(turn, storage);

    expect(readPendingChatTurn("server-1", storage)).toMatchObject(turn);
    expect(readPendingChatTurn("server-2", storage)).toBeNull();
  });

  it("drops expired and explicitly cleared turns", () => {
    const storage = createStorage();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    savePendingChatTurn(
      {
        serverId: "server-1",
        userInput: "Read my profile",
        promptResults: [],
        attachments: [],
        baseMessages: [],
      },
      storage
    );

    vi.spyOn(Date, "now").mockReturnValue(16 * 60_000);
    expect(readPendingChatTurn("server-1", storage)).toBeNull();

    vi.spyOn(Date, "now").mockReturnValue(20 * 60_000);
    savePendingChatTurn(
      {
        serverId: "server-1",
        userInput: "Read my profile",
        promptResults: [],
        attachments: [],
        baseMessages: [],
      },
      storage
    );
    clearPendingChatTurn("server-1", storage);
    expect(readPendingChatTurn("server-1", storage)).toBeNull();
  });
});
