import { describe, expect, it } from "vitest";
import { createManualClock } from "../../../src/events/internal/clock.js";
import type { EventsRegistry } from "../../../src/events/internal/registry.js";
import {
  syncCatalog,
  buildCatalogRecord,
} from "../../../src/events/store/catalog.js";
import {
  mergeRecord,
  readRecord,
  updateRecord,
  writeRecord,
} from "../../../src/events/store/codec.js";
import { createEventsKeyring } from "../../../src/events/store/keyring.js";
import {
  createEventsKeys,
  decodeName,
  encodeName,
} from "../../../src/events/store/keys.js";
import { ensureMeta, readMetaLayout } from "../../../src/events/store/meta.js";
import { createSealer } from "../../../src/events/store/seal.js";
import { ReferenceDatabase } from "../../storage/reference-storage.js";

describe("key codec", () => {
  it("builds hash-tagged keys with the prefix and percent-encoded names", async () => {
    const keys = await createEventsKeys({
      prefix: "t/",
      namespace: "srv:prod",
    });
    expect(keys.root).toMatch(/^t\/ev:\{[A-Za-z0-9_-]{16}\}:$/);
    expect(keys.log("a:b{c}%")).toBe(`${keys.root}log:a%3Ab%7Bc%7D%25`);
    expect(decodeName(encodeName("a:b{c}%"))).toBe("a:b{c}%");
  });

  it("R-3: name x:p:y and name x with partition y give distinct keys", async () => {
    const keys = await createEventsKeys({ namespace: "n" });
    const a = keys.byName("x:p:y");
    const b = await keys.byNamePartition("x", "y");
    expect(a).not.toBe(b);
    expect(keys.log("a")).not.toBe(keys.log("b"));
    const other = await createEventsKeys({ namespace: "m" });
    expect(other.meta()).not.toBe(keys.meta());
  });

  it("never puts a principal, URL or partition in plaintext", async () => {
    const keys = await createEventsKeys({ namespace: "n" });
    const secret = "PLANTED-SECRET";
    const built = [
      await keys.byPrincipal(`iss|${secret}`),
      await keys.anonUrl(`https://${secret}.example/hook`),
      await keys.byNamePartition("e", secret),
    ];
    for (const k of built) expect(k).not.toContain(secret);
  });

  it("rejects a prefix with braces", async () => {
    await expect(
      createEventsKeys({ prefix: "a{", namespace: "n" })
    ).rejects.toThrow("must not contain");
  });
});

describe("sealing", () => {
  it("binds the value to its key and opens with any key of the ring (R-7)", async () => {
    const oldRing = await createEventsKeyring("old-secret");
    const sealedOld = await createSealer(oldRing).seal("k1", '{"a":1}');
    expect(sealedOld).not.toContain('"a"');
    const rotated = createSealer(
      await createEventsKeyring(["new-secret", "old-secret"])
    );
    expect(await rotated.open("k1", sealedOld)).toBe('{"a":1}');
    expect(await rotated.open("k2", sealedOld)).toBeUndefined();
    const sealedNew = await rotated.seal("k1", "x");
    expect(await createSealer(oldRing).open("k1", sealedNew)).toBeUndefined();
  });
});

describe("namespace meta", () => {
  it("is created once, keeps the cursor key across key rotation, and reports layout without a keyring", async () => {
    const db = new ReferenceDatabase();
    const storage = db.store();
    const keys = await createEventsKeys({ namespace: "n" });
    const clock = createManualClock(1000);
    const first = await ensureMeta(
      storage,
      createSealer(await createEventsKeyring("s1")),
      keys.meta(),
      clock
    );
    expect(first.created).toBe(true);
    expect(first.cursorKey.length).toBe(32);
    const again = await ensureMeta(
      storage,
      createSealer(await createEventsKeyring(["s2", "s1"])),
      keys.meta(),
      clock
    );
    expect(again.created).toBe(false);
    expect(Array.from(again.cursorKey)).toEqual(Array.from(first.cursorKey));
    expect(await readMetaLayout(storage, keys.meta())).toBe(1);
  });

  it("marks layout 2 as degraded", async () => {
    const db = new ReferenceDatabase();
    const storage = db.store();
    const keys = await createEventsKeys({ namespace: "n" });
    await storage.write(
      keys.meta(),
      JSON.stringify({ v: 1, layout: 2, createdAt: 5, cursorKey: "x" })
    );
    const meta = await ensureMeta(
      storage,
      createSealer(await createEventsKeyring("s")),
      keys.meta(),
      createManualClock()
    );
    expect(meta.degraded).toBe(true);
    expect(meta.layout).toBe(2);
  });
});

describe("forward-compatible codec", () => {
  it("keeps unknown fields through read-modify-write", async () => {
    const db = new ReferenceDatabase();
    const storage = db.store();
    const sealer = createSealer(await createEventsKeyring("s"));
    await writeRecord(storage, sealer, "k", { v: 1, a: 1, future: { x: 1 } });
    await updateRecord<{ v: 1; a: number }>(storage, sealer, "k", (cur) => ({
      v: 1,
      a: (cur?.a ?? 0) + 1,
    }));
    const got = await readRecord<Record<string, unknown>>(storage, sealer, "k");
    expect(got?.value).toEqual({ v: 1, a: 2, future: { x: 1 } });
    expect(mergeRecord({ n: { a: 1, z: 2 } }, { n: { a: 3 } })).toEqual({
      n: { a: 3, z: 2 },
    });
  });
});

describe("catalog", () => {
  it("writes when the hash differs and records missing names", async () => {
    const db = new ReferenceDatabase();
    const storage = db.store();
    const sealer = createSealer(await createEventsKeyring("s"));
    const keys = await createEventsKeys({ namespace: "n" });
    const reg = (hash: string, names: string[]): EventsRegistry =>
      ({
        size: names.length,
        catalogHash: hash,
        get: () => undefined,
        all: () =>
          names.map((name) => ({
            name,
            schemaHash: `h-${name}`,
            replay: false,
            hooks: { onSubscribe: false, onUnsubscribe: true },
          })),
      }) as unknown as EventsRegistry;
    const r1 = await syncCatalog(
      storage,
      sealer,
      keys,
      buildCatalogRecord(reg("h1", ["a", "b"]), 10)
    );
    expect(r1).toEqual({ written: true, missing: {} });
    const r2 = await syncCatalog(
      storage,
      sealer,
      keys,
      buildCatalogRecord(reg("h1", ["a", "b"]), 20)
    );
    expect(r2.written).toBe(false);
    const r3 = await syncCatalog(
      storage,
      sealer,
      keys,
      buildCatalogRecord(reg("h2", ["a"]), 30)
    );
    expect(r3).toEqual({ written: true, missing: { b: 30 } });
    const r4 = await syncCatalog(
      storage,
      sealer,
      keys,
      buildCatalogRecord(reg("h3", ["a", "b"]), 40)
    );
    expect(r4).toEqual({ written: true, missing: {} });
  });
});
