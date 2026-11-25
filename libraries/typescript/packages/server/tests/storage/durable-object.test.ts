/**
 * cloudflareStorage({ durableObject }) against McpUseStorageDurableObject
 * running in workerd through Miniflare. The adapter file has only type
 * imports, so stripping its types gives the Worker module.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cloudflareStorage } from "../../src/storage/adapters/cloudflare-d1.js";
import type { DurableObjectNamespaceLike } from "../../src/storage/adapters/cloudflare-do.js";
import { runStorageConformance } from "../../src/storage/conformance.js";
import { limitDurableObject } from "./miniflare-limit.js";
import { assertMcpUseStorage, StorageError } from "../../src/storage/types.js";

const source = readFileSync(
  fileURLToPath(
    new URL("../../src/storage/adapters/cloudflare-do.ts", import.meta.url)
  ),
  "utf8"
);
const script = `${stripTypeScriptTypes(source, { mode: "strip" })}
export default { fetch() { return new Response("ok"); } };`;

let mf: Miniflare;
let store: DurableObjectNamespaceLike;
let oauthOnly: DurableObjectNamespaceLike;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2025-09-01",
    durableObjects: {
      STORE: "McpUseStorageDurableObject",
      OAUTH: "OAuthProxyDurableObject",
    },
  });
  store = limitDurableObject(
    (await mf.getDurableObjectNamespace(
      "STORE"
    )) as unknown as DurableObjectNamespaceLike
  );
  oauthOnly = limitDurableObject(
    (await mf.getDurableObjectNamespace(
      "OAUTH"
    )) as unknown as DurableObjectNamespaceLike
  );
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describe("cloudflareStorage({ durableObject })", () => {
  it("passes the storage conformance suite", async () => {
    const storage = cloudflareStorage({ durableObject: store, prefix: "t:" });
    const report = await runStorageConformance(storage, {
      prefix: "t:",
      open: (prefix) => cloudflareStorage({ durableObject: store, prefix }),
    });
    expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(
      Object.fromEntries(report.checks.map((c) => [c.id, c.status]))
    ).toMatchObject({ SIGNAL: "skip", BATCH: "pass", "REMOVE-PREFIX": "pass" });
    expect(report.kind).toBe("durable-object");
  }, 120_000);

  it("keeps OAuth working on an OAuthProxyDurableObject binding", async () => {
    const storage = cloudflareStorage({ durableObject: oauthOnly });
    expect(await storage.add("code", "v", 60)).toBe(true);
    expect(await storage.add("code", "w", 60)).toBe(false);
    expect(await storage.take("code")).toBe("v");
    expect(await storage.get("code")).toBe(undefined);
  });

  it("names McpUseStorageDurableObject when Events reach the OAuth-only class", async () => {
    const storage = cloudflareStorage({ durableObject: oauthOnly });
    await expect(storage.read("k")).rejects.toThrow(
      "bind McpUseStorageDurableObject"
    );
  });

  it("serves OAuth operations on McpUseStorageDurableObject", async () => {
    const storage = cloudflareStorage({ durableObject: store, prefix: "o:" });
    await storage.set("s", "1", 60);
    expect(await storage.get("s")).toBe("1");
    expect(await storage.take("s")).toBe("1");
    expect(await storage.take("s")).toBe(undefined);
  });

  it("rejects a Workers KV binding with STORAGE_UNSUPPORTED", async () => {
    const kvMf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      kvNamespaces: ["KV"],
    });
    try {
      const kv = await kvMf.getKVNamespace("KV");
      let thrown: unknown;
      try {
        assertMcpUseStorage(kv);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(StorageError);
      expect((thrown as StorageError).code).toBe("STORAGE_UNSUPPORTED");
      expect((thrown as StorageError).message).toContain(
        "cloudflareStorage({ durableObject })"
      );
    } finally {
      await kvMf.dispose();
    }
  });
});
