import { describe, expect, it, vi } from "vitest";
import {
  createChatSession,
  createChatSessionId,
  resolveActiveChatId,
} from "../chat-session";

describe("createChatSessionId", () => {
  it("mints a distinct id per session", () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => createChatSessionId())
    );
    expect(ids.size).toBe(50);
  });

  it("still mints ids where randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    try {
      expect(createChatSessionId()).not.toBe(createChatSessionId());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("createChatSession", () => {
  it("starts idle, with its own runtime", () => {
    const a = createChatSession("a");
    const b = createChatSession("b");

    expect(a.isLoading).toBe(false);
    expect(a.persistedChatId).toBeNull();
    expect(a.creation).toBeNull();
    expect(a.runtime).not.toBe(b.runtime);
    expect(a.runtime.sendInProgress).toBe(false);
  });
});

describe("resolveActiveChatId", () => {
  it("follows the host while controlled, ignoring internal state", () => {
    expect(resolveActiveChatId(true, "chat-1", "internal-1")).toBe("chat-1");
    // The host cleared its id, so no chat is active — even though a previous
    // internal id is still around.
    expect(resolveActiveChatId(true, undefined, "internal-1")).toBeNull();
  });

  it("uses internal state when uncontrolled", () => {
    expect(resolveActiveChatId(false, undefined, "internal-1")).toBe(
      "internal-1"
    );
    expect(resolveActiveChatId(false, undefined, null)).toBeNull();
  });
});
