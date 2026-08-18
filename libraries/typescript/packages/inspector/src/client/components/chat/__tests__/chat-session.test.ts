import { describe, expect, it, vi } from "vitest";
import { createChatSessionId } from "../chat-session";

describe("createChatSessionId", () => {
  it("still mints ids where randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    try {
      expect(createChatSessionId()).not.toBe(createChatSessionId());
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
