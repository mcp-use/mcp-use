import { describe, expect, it } from "vitest";
import {
  clearPendingToolExecution,
  readPendingToolExecution,
  savePendingToolExecution,
  type PendingToolExecution,
} from "../tool-auth-retry";

function createSessionStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("pending tool OAuth retry", () => {
  const pending: PendingToolExecution = {
    serverId: "http://localhost:3001/mcp",
    toolName: "protected_profile",
    args: { detail: true },
    displayArgs: { detail: true },
    timestamp: 42,
  };

  it("round-trips the exact request across a full-page authorization", () => {
    const storage = createSessionStorage();

    savePendingToolExecution(pending, storage);

    expect(readPendingToolExecution(pending.serverId, storage)).toEqual(
      pending
    );
  });

  it("does not expose one server's pending request to another server", () => {
    const storage = createSessionStorage();
    const other = {
      ...pending,
      serverId: "https://different.example/mcp",
      toolName: "other_tool",
      timestamp: 43,
    };
    savePendingToolExecution(pending, storage);
    savePendingToolExecution(other, storage);

    expect(readPendingToolExecution(pending.serverId, storage)).toEqual(
      pending
    );
    expect(readPendingToolExecution(other.serverId, storage)).toEqual(other);
    expect(storage.length).toBe(2);
  });

  it("consumes the pending request after the authenticated retry starts", () => {
    const storage = createSessionStorage();
    savePendingToolExecution(pending, storage);

    clearPendingToolExecution(pending.serverId, storage);

    expect(readPendingToolExecution(pending.serverId, storage)).toBeNull();
  });

  it("discards malformed pending requests", () => {
    const storage = createSessionStorage();
    savePendingToolExecution(pending, storage);
    storage.setItem(storage.key(0)!, JSON.stringify({ toolName: "" }));

    expect(readPendingToolExecution(pending.serverId, storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("discards a stale pending request instead of rerunning it later", () => {
    const storage = createSessionStorage();
    savePendingToolExecution(pending, storage);
    const key = storage.key(0)!;
    const stored = JSON.parse(storage.getItem(key)!);
    storage.setItem(
      key,
      JSON.stringify({ ...stored, savedAt: Date.now() - 24 * 60 * 60_000 })
    );

    expect(readPendingToolExecution(pending.serverId, storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("treats blocked browser session storage as unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage"
    );
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new Error("Storage access blocked");
      },
    });

    try {
      expect(readPendingToolExecution(pending.serverId)).toBeNull();
      expect(() => savePendingToolExecution(pending)).not.toThrow();
      expect(() => clearPendingToolExecution(pending.serverId)).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "sessionStorage", descriptor);
      } else {
        Reflect.deleteProperty(globalThis, "sessionStorage");
      }
    }
  });
});
