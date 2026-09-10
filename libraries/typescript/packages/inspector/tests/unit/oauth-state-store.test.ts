import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  createMemoryOAuthProxyStateStore,
  decodeOAuthProxyEncryptionKey,
} from "../../src/server/proxy/oauth-state-store";

describe("Inspector OAuth state stores", () => {
  it("expires memory entries and keeps setIfNewer atomic in-process", async () => {
    const store = createMemoryOAuthProxyStateStore();

    await store.set("temporary", { value: "gone" }, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await store.get("temporary")).toBeUndefined();

    await store.setIfNewer("versioned", { revision: 2, updatedAt: 20 });
    expect(
      await store.setIfNewer("versioned", { revision: 1, updatedAt: 30 })
    ).toBe(false);
    expect(await store.get("versioned")).toEqual({
      revision: 2,
      updatedAt: 20,
    });

    await Promise.all([
      store.setIfNewer("concurrent", { revision: 1, updatedAt: 1 }),
      store.setIfNewer("concurrent", { revision: 2, updatedAt: 2 }),
    ]);
    expect(await store.get("concurrent")).toEqual({
      revision: 2,
      updatedAt: 2,
    });

    await Promise.all([
      store.setIfNewer("higher-first", { revision: 3, updatedAt: 3 }),
      store.setIfNewer("higher-first", { revision: 2, updatedAt: 4 }),
    ]);
    expect(await store.get("higher-first")).toEqual({
      revision: 3,
      updatedAt: 3,
    });

    await store.set("deletion-race", { revision: 4, updatedAt: 4 });
    expect(
      await store.deleteIfVersion?.("deletion-race", {
        revision: 3,
        updatedAt: 5,
      })
    ).toBe(false);
    expect(await store.get("deletion-race")).toEqual({
      revision: 4,
      updatedAt: 4,
    });
    expect(
      await store.deleteIfVersion?.("deletion-race", {
        revision: 4,
        updatedAt: 4,
      })
    ).toBe(true);
    expect(await store.get("deletion-race")).toBeUndefined();
    await store.close?.();
  });

  it("accepts exactly 32-byte base64 encryption keys", () => {
    const encoded = Buffer.alloc(32, 7).toString("base64");
    expect(decodeOAuthProxyEncryptionKey(encoded)).toHaveLength(32);
    expect(() => decodeOAuthProxyEncryptionKey("AAAA")).toThrow(
      "must decode to 32 bytes"
    );
  });
});
