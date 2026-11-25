/**
 * cloudflareStorage({ d1 }) against a D1 database in Miniflare (workerd's
 * SQLite).
 */
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cloudflareStorage,
  type D1LikeDatabase,
} from "../../src/storage/adapters/cloudflare-d1.js";
import { runStorageConformance } from "../../src/storage/conformance.js";
import { limitD1 } from "./miniflare-limit.js";

let mf: Miniflare;
let db: D1LikeDatabase;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    d1Databases: ["DB"],
  });
  db = limitD1((await mf.getD1Database("DB")) as unknown as D1LikeDatabase);
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describe("cloudflareStorage({ d1 })", () => {
  it("passes the storage conformance suite", async () => {
    const storage = cloudflareStorage({ d1: db, prefix: "t:" });
    const report = await runStorageConformance(storage, {
      prefix: "t:",
      open: (prefix) => cloudflareStorage({ d1: db, prefix }),
    });
    expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(report.kind).toBe("d1");
    expect(
      Object.fromEntries(report.checks.map((c) => [c.id, c.status]))
    ).toMatchObject({ SIGNAL: "skip", "LOG-SEQ": "pass", "LOG-EPOCH": "pass" });
  }, 120_000);

  it("leaves an existing OAuth table byte-identical", async () => {
    const run = (sql: string) => db.prepare(sql).bind().run();
    await run(
      "CREATE TABLE legacy_oauth (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)"
    );
    await run("INSERT INTO legacy_oauth VALUES ('k1', 'v1', 4102444800000)");
    const snapshot = async () => ({
      schema: await db
        .prepare("SELECT sql FROM sqlite_master WHERE name = 'legacy_oauth'")
        .bind()
        .first(),
      rows: await db.prepare("SELECT * FROM legacy_oauth").bind().all!(),
    });
    const before = await snapshot();
    const storage = cloudflareStorage({ d1: db, table: "legacy_oauth" });
    await storage.write("events-key", "x");
    await storage.logAppend("events-log", "e", { maxEvents: 10 });
    expect(await storage.get("k1")).toBe("v1");
    const after = await snapshot();
    expect(after.schema).toEqual(before.schema);
    expect(after.rows.results).toEqual([
      { key: "k1", value: "v1", expires_at: 4102444800000 },
    ]);
  });
});
