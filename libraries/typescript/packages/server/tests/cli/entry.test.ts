/** Unit tests for entry discovery (CLI_SPEC.md § Entry contract). */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { discoverEntry, ENTRY_CANDIDATES } from "../../src/cli/index.js";
import { removeDir, TMP_ROOT } from "./helpers.js";

let counter = 0;
const dirs: string[] = [];

function makeProject(files: string[]): string {
  const dir = join(TMP_ROOT, `entry-${process.pid}-${counter++}`);
  for (const file of files) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "export default {};\n");
  }
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe("discoverEntry", () => {
  it("finds each conventional candidate", () => {
    for (const candidate of ENTRY_CANDIDATES) {
      const dir = makeProject([candidate]);
      expect(discoverEntry(dir)).toBe(join(dir, candidate));
    }
  });

  it("prefers candidates in order (first hit wins)", () => {
    const dir = makeProject(["src/index.ts", "src/server.ts", "index.ts"]);
    expect(discoverEntry(dir)).toBe(join(dir, "src/index.ts"));

    const dir2 = makeProject(["src/server.ts", "server.ts"]);
    expect(discoverEntry(dir2)).toBe(join(dir2, "src/server.ts"));
  });

  it("resolves an --entry override relative to cwd", () => {
    const dir = makeProject(["custom/main.ts"]);
    expect(discoverEntry(dir, "custom/main.ts")).toBe(
      join(dir, "custom/main.ts")
    );
  });

  it("accepts an absolute --entry override", () => {
    const dir = makeProject(["custom/main.ts"]);
    const absolute = join(dir, "custom/main.ts");
    expect(discoverEntry(dir, absolute)).toBe(absolute);
  });

  it("throws when the --entry override does not exist", () => {
    const dir = makeProject([]);
    expect(() => discoverEntry(dir, "nope.ts")).toThrow(/Entry not found/);
  });

  it("throws listing every candidate when none is found", () => {
    const dir = makeProject([]);
    expect(() => discoverEntry(dir)).toThrow(
      /src\/index\.ts, src\/index\.tsx, src\/server\.ts, src\/server\.tsx, index\.ts, index\.tsx, server\.ts, server\.tsx/
    );
  });
});
