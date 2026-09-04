import { describe, expect, it } from "vitest";
import {
  createRedisOAuthProxyStateStore,
  type OAuthProxyEncryptionKey,
} from "../../src/server/proxy/oauth-state-store";

const redisUrl = process.env.INSPECTOR_REDIS_TEST_URL;
const describeRedis = describe.skipIf(!redisUrl);

const oldKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const newKey = Uint8Array.from({ length: 32 }, (_, index) => index + 33);
const previousKey: OAuthProxyEncryptionKey = { id: "old", key: oldKey };

describeRedis("Redis Inspector OAuth state store", () => {
  it("round-trips encrypted state, rotates keys, arbitrates CAS, and closes", async () => {
    const prefix = `mcp-use:test:${process.pid}:${Date.now()}:`;
    const oldStore = createRedisOAuthProxyStateStore({
      url: redisUrl!,
      encryptionKey: oldKey,
      encryptionKeyId: "old",
      decryptionKeys: [{ id: "new", key: newKey }],
      keyPrefix: prefix,
    });
    const rotatedStore = createRedisOAuthProxyStateStore({
      url: redisUrl!,
      encryptionKey: newKey,
      encryptionKeyId: "new",
      decryptionKeys: [previousKey],
      keyPrefix: prefix,
    });
    const wrongKeyStore = createRedisOAuthProxyStateStore({
      url: redisUrl!,
      encryptionKey: newKey,
      encryptionKeyId: "new-only",
      keyPrefix: prefix,
    });

    try {
      await oldStore.ready?.();
      await rotatedStore.ready?.();
      await wrongKeyStore.ready?.();

      await oldStore.set("rotation", { revision: 1, updatedAt: 1 });
      expect(await rotatedStore.get("rotation")).toEqual({
        revision: 1,
        updatedAt: 1,
      });
      await expect(wrongKeyStore.get("rotation")).rejects.toThrow(
        "Unable to decrypt OAuth proxy state"
      );

      const results = await Promise.all([
        oldStore.setIfNewer?.("cas", { revision: 1, updatedAt: 1 }),
        rotatedStore.setIfNewer?.("cas", { revision: 2, updatedAt: 2 }),
      ]);
      expect(results).toContain(true);
      expect(await rotatedStore.get("cas")).toEqual({
        revision: 2,
        updatedAt: 2,
      });
    } finally {
      await oldStore.delete("rotation").catch(() => undefined);
      await oldStore.delete("cas").catch(() => undefined);
      await Promise.all([
        oldStore.close?.(),
        rotatedStore.close?.(),
        wrongKeyStore.close?.(),
      ]);
    }
  });
});
