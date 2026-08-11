import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_MODE_STORAGE_KEY,
  readStoredChatMode,
  resolveInitialForceClientSide,
  writeStoredChatMode,
} from "../chatModeStorage";

const storedValues = new Map<string, string>();
vi.stubGlobal("localStorage", {
  get length() {
    return storedValues.size;
  },
  clear() {
    storedValues.clear();
  },
  getItem(key: string) {
    return storedValues.get(key) ?? null;
  },
  key(index: number) {
    return [...storedValues.keys()][index] ?? null;
  },
  removeItem(key: string) {
    storedValues.delete(key);
  },
  setItem(key: string, value: string) {
    storedValues.set(key, value);
  },
} satisfies Storage);

afterAll(() => {
  vi.unstubAllGlobals();
});

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

  it("lets an embedded host lock its managed stream over stored BYOK mode", () => {
    writeStoredChatMode("byok");

    expect(resolveInitialForceClientSide(true, null, true)).toBe(false);
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
