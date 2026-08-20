import { describe, expect, it, vi } from "vitest";
import { createChatSessionId } from "../chat-session";

describe("createChatSessionId", () => {
  it("uses secure random values where randomUUID is unavailable", () => {
    let value = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(++value);
        return bytes;
      },
    });
    try {
      expect(createChatSessionId()).not.toBe(createChatSessionId());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails when secure random generation is unavailable", () => {
    vi.stubGlobal("crypto", {});
    try {
      expect(() => createChatSessionId()).toThrow(
        "Secure random generation is unavailable"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
