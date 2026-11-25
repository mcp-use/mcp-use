import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fileStorage } from "../../src/storage/adapters/file.js";
import { runStorageConformance } from "../../src/storage/conformance.js";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "mcp-use-file-storage-"));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const ADAPTER = resolve(__dirname, "../../src/storage/adapters/file.ts");

/**
 * Runs `body` in a fresh Node process with `storage = fileStorage(dir)` and
 * returns what it returns. Node strips the types; a resolve hook maps the
 * sources' `.js` specifiers to their `.ts` files.
 */
function inChild(dir: string, body: string): unknown {
  const hooksDir = tempDir();
  const hooks = join(hooksDir, "hooks.mjs");
  writeFileSync(
    hooks,
    `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) { if (specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context); throw error; }
}});`
  );
  const script = `const { fileStorage } = await import(${JSON.stringify(ADAPTER)});
const storage = fileStorage(${JSON.stringify(dir)});
const result = await (async () => { ${body} })();
process.stdout.write(JSON.stringify(result));`;
  const out = execFileSync(
    process.execPath,
    ["--no-warnings", "--import", hooks, "--input-type=module", "-e", script],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(out);
}

describe("fileStorage", () => {
  it("passes the storage conformance suite", async () => {
    const dir = tempDir();
    const report = await runStorageConformance(fileStorage(dir), {
      ttlMs: 150,
      open: (prefix) => fileStorage(dir, { prefix }),
    });
    expect(report.kind).toBe("file");
    expect(report.checks.filter((check) => check.status === "fail")).toEqual(
      []
    );
    expect(
      report.checks.filter((c) => c.status === "skip").map((c) => c.id)
    ).toEqual(["BATCH"]);
  });

  it("keeps values, indexes, logs and dedupe keys across a process restart", () => {
    const dir = tempDir();
    const epoch = inChild(
      dir,
      `await storage.write("k", "v1");
       await storage.indexAdd("ix", "m", 7);
       const a = await storage.logAppend("log", "e1", { maxEvents: 10, dedupe: { key: "d1", ttlMs: 60000 } });
       await storage.logAppend("log", "e2", { maxEvents: 10 });
       return a.epoch;`
    );
    const after = inChild(
      dir,
      `const range = await storage.logRange("log", { after: null, limit: 10 });
       const dup = await storage.logAppend("log", "again", { maxEvents: 10, dedupe: { key: "d1", ttlMs: 60000 } });
       const next = await storage.logAppend("log", "e3", { maxEvents: 10 });
       return { value: (await storage.read("k"))?.value, index: (await storage.indexRange("ix", { limit: 5 })).items, range, dup, next };`
    );
    expect(typeof epoch).toBe("string");
    expect(after).toEqual({
      value: "v1",
      index: [{ member: "m", score: 7 }],
      range: {
        entries: [
          { seq: 1, value: "e1" },
          { seq: 2, value: "e2" },
        ],
        epoch,
        first: 1,
        head: 2,
      },
      dup: { duplicate: true, seq: 1 },
      next: { duplicate: false, seq: 3, epoch },
    });
  });

  it("refuses a directory another live process holds", () => {
    const dir = tempDir();
    fileStorage(dir);
    expect(() => inChild(dir, "return 1;")).toThrow(/is in use by process/);
  });

  it("shares one store between calls with the same directory in one process", async () => {
    const dir = tempDir();
    await fileStorage(dir).write("k", "shared");
    expect((await fileStorage(dir).read("k"))?.value).toBe("shared");
    expect(readFileSync(join(dir, "lock"), "utf8")).toBe(String(process.pid));
  });
});
