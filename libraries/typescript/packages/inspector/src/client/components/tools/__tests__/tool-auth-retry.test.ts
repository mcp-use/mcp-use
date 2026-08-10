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
    savePendingToolExecution(pending, storage);

    expect(
      readPendingToolExecution("https://different.example/mcp", storage)
    ).toBeNull();
    expect(readPendingToolExecution(pending.serverId, storage)).toEqual(
      pending
    );
  });

  it("consumes the pending request after the authenticated retry starts", () => {
    const storage = createSessionStorage();
    savePendingToolExecution(pending, storage);

    clearPendingToolExecution(pending.serverId, storage);

    expect(readPendingToolExecution(pending.serverId, storage)).toBeNull();
  });

  it("discards malformed pending requests", () => {
    const storage = createSessionStorage();
    storage.setItem(
      "__mcpUseInspectorPendingToolExecution",
      JSON.stringify({ serverId: pending.serverId, toolName: "" })
    );

    expect(readPendingToolExecution(pending.serverId, storage)).toBeNull();
    expect(storage.length).toBe(0);
  });
});
