import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSystemPromptStorageKey,
  readStoredSystemPrompt,
  resolveSystemPrompt,
  writeStoredSystemPrompt,
} from "../local-storage";
import { DEFAULT_CHAT_SYSTEM_PROMPT } from "../../system-prompt-default";

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
    store,
  };
}

describe("local system prompt storage", () => {
  let storage: ReturnType<typeof createStorageMock>;

  beforeEach(() => {
    storage = createStorageMock();
    vi.stubGlobal("localStorage", storage);
  });

  it("reads and writes per serverId", () => {
    const key = getSystemPromptStorageKey("server-a");
    expect(readStoredSystemPrompt("server-a")).toBeNull();

    writeStoredSystemPrompt("server-a", "Custom prompt");
    expect(storage.setItem).toHaveBeenCalledWith(key, "Custom prompt");
    expect(readStoredSystemPrompt("server-a")).toBe("Custom prompt");
    expect(readStoredSystemPrompt("server-b")).toBeNull();
  });

  it("falls back to default when unset", () => {
    expect(resolveSystemPrompt(null)).toBe(DEFAULT_CHAT_SYSTEM_PROMPT);
    expect(resolveSystemPrompt("")).toBe(DEFAULT_CHAT_SYSTEM_PROMPT);
    expect(resolveSystemPrompt("  ")).toBe(DEFAULT_CHAT_SYSTEM_PROMPT);
    expect(resolveSystemPrompt("Custom")).toBe("Custom");
  });
});
