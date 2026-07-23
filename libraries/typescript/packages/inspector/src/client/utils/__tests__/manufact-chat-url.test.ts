import { describe, expect, it } from "vitest";
import {
  DEFAULT_MANUFACT_CHAT_URL,
  resolveManufactChatUrl,
} from "../manufact-chat-url";

describe("resolveManufactChatUrl", () => {
  it("prefers the runtime URL", () => {
    expect(
      resolveManufactChatUrl(
        "https://runtime.example/chat",
        "https://build.example/chat"
      )
    ).toBe("https://runtime.example/chat");
  });

  it("uses the build-time URL when no runtime URL is set", () => {
    expect(
      resolveManufactChatUrl(undefined, "https://build.example/chat")
    ).toBe("https://build.example/chat");
  });

  it("falls back to Manufact Cloud when no URL is configured", () => {
    expect(resolveManufactChatUrl()).toBe(DEFAULT_MANUFACT_CHAT_URL);
  });

  it("treats blank configured URLs as unset", () => {
    expect(resolveManufactChatUrl(" ", "\n")).toBe(DEFAULT_MANUFACT_CHAT_URL);
  });
});
