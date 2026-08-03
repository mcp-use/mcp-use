// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorageKVStore } from "../../../src/auth/storage.js";
import { installMemoryLocalStorage } from "../../helpers/memory-local-storage.js";

const DATABASE_NAME = "mcp-use-oauth-crypto";

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Test database deletion blocked"));
  });
}

describe("LocalStorageKVStore", () => {
  let restoreLocalStorage: () => void;

  beforeEach(async () => {
    restoreLocalStorage = installMemoryLocalStorage();
    localStorage.clear();
    await deleteDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreLocalStorage();
  });

  it("encrypts values and decrypts them after recreating the store", async () => {
    const first = new LocalStorageKVStore();
    await first.set("mcp:auth_tokens", '{"access_token":"top-secret"}');

    const raw = localStorage.getItem("mcp:auth_tokens");
    expect(raw).not.toContain("top-secret");
    expect(JSON.parse(raw ?? "{}")).toMatchObject({
      v: 1,
      alg: "A256GCM",
    });

    const second = new LocalStorageKVStore();
    await expect(second.get("mcp:auth_tokens")).resolves.toBe(
      '{"access_token":"top-secret"}'
    );
  });

  it("shares one origin key across concurrently initialized contexts", async () => {
    const opener = new LocalStorageKVStore();
    const popup = new LocalStorageKVStore();

    await Promise.all([
      opener.set("mcp:auth_opener", "one"),
      popup.set("mcp:auth_popup", "two"),
    ]);

    await expect(opener.get("mcp:auth_popup")).resolves.toBe("two");
    await expect(popup.get("mcp:auth_opener")).resolves.toBe("one");
  });

  it("migrates legacy plaintext on first read", async () => {
    localStorage.setItem("mcp:auth_legacy", "legacy-secret");

    const store = new LocalStorageKVStore();
    await expect(store.get("mcp:auth_legacy")).resolves.toBe("legacy-secret");
    expect(localStorage.getItem("mcp:auth_legacy")).not.toContain(
      "legacy-secret"
    );

    await expect(
      new LocalStorageKVStore().get("mcp:auth_legacy")
    ).resolves.toBe("legacy-secret");
  });

  it("deletes corrupt encrypted values", async () => {
    localStorage.setItem(
      "mcp:auth_corrupt",
      JSON.stringify({
        v: 1,
        alg: "A256GCM",
        iv: "not-base64",
        ciphertext: "not-base64",
      })
    );

    await expect(
      new LocalStorageKVStore().get("mcp:auth_corrupt")
    ).resolves.toBeNull();
    expect(localStorage.getItem("mcp:auth_corrupt")).toBeNull();
  });

  it("falls back to memory and removes plaintext without IndexedDB", async () => {
    localStorage.setItem("mcp:auth_legacy", "must-not-remain");
    vi.stubGlobal("indexedDB", undefined);

    const store = new LocalStorageKVStore();
    await expect(store.get("mcp:auth_legacy")).resolves.toBe("must-not-remain");
    expect(localStorage.getItem("mcp:auth_legacy")).toBeNull();

    await store.set("mcp:auth_tokens", "memory-only");
    await expect(store.get("mcp:auth_tokens")).resolves.toBe("memory-only");
    expect(localStorage.getItem("mcp:auth_tokens")).toBeNull();
    expect(store.keys()).toContain("mcp:auth_tokens");

    store.remove("mcp:auth_tokens");
    await expect(store.get("mcp:auth_tokens")).resolves.toBeNull();
  });
});
