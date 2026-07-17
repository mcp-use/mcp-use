import { beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_MODE_STORAGE_KEY,
  readStoredChatMode,
  resolveInitialForceClientSide,
  writeStoredChatMode,
} from "../chatModeStorage";

describe("chatModeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and reads chat mode", () => {
    writeStoredChatMode("byok");
    expect(readStoredChatMode()).toBe("byok");
    writeStoredChatMode("managed");
    expect(readStoredChatMode()).toBe("managed");
  });

  it("resolves BYOK from stored mode before localLlmConfig loads", () => {
    writeStoredChatMode("byok");
    expect(resolveInitialForceClientSide(false, null)).toBe(true);
  });

  it("migrates legacy llm-config without mode key to BYOK on hosted inspector", () => {
    localStorage.setItem(
      "mcp-inspector-llm-config",
      JSON.stringify({ provider: "openai", model: "gpt-4o", apiKey: "x" })
    );
    expect(resolveInitialForceClientSide(false, null)).toBe(true);
  });

  it("does not migrate legacy llm-config when host owns the stream", () => {
    localStorage.setItem(
      "mcp-inspector-llm-config",
      JSON.stringify({ provider: "openai", model: "gpt-4o", apiKey: "x" })
    );
    expect(resolveInitialForceClientSide(true, null)).toBe(false);
  });

  it("stored managed mode wins over legacy llm-config", () => {
    localStorage.setItem(
      "mcp-inspector-llm-config",
      JSON.stringify({ provider: "openai", model: "gpt-4o", apiKey: "x" })
    );
    writeStoredChatMode("managed");
    expect(resolveInitialForceClientSide(false, null)).toBe(false);
  });

  it("uses CHAT_MODE_STORAGE_KEY", () => {
    writeStoredChatMode("byok");
    expect(localStorage.getItem(CHAT_MODE_STORAGE_KEY)).toBe("byok");
  });
});
