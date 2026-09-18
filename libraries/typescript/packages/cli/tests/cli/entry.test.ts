/** Unit tests for entry discovery. */
import { join } from "node:path";
import { describe, expect } from "vitest";
import { it } from "./fixtures.js";
import type { TestProjects } from "./project.js";

import { discoverEntry, ENTRY_CANDIDATES } from "../../src/cli/index.js";
function makeProject(projects: TestProjects, files: string[]): string {
  const project = projects.create("empty");
  for (const file of files) project.writeFile(file, "export default {};\n");
  return project.cwd;
}

describe("discoverEntry", () => {
  it("finds each conventional candidate", ({ projects }) => {
    for (const candidate of ENTRY_CANDIDATES) {
      const dir = makeProject(projects, [candidate]);
      expect(discoverEntry(dir)).toBe(join(dir, candidate));
    }
  });

  it("prefers candidates in order (first hit wins)", ({ projects }) => {
    const dir = makeProject(projects, [
      "src/index.ts",
      "src/server.ts",
      "index.ts",
    ]);
    expect(discoverEntry(dir)).toBe(join(dir, "src/index.ts"));

    const dir2 = makeProject(projects, ["src/server.ts", "server.ts"]);
    expect(discoverEntry(dir2)).toBe(join(dir2, "src/server.ts"));
  });

  it("resolves an --entry override relative to cwd", ({ projects }) => {
    const dir = makeProject(projects, ["custom/main.ts"]);
    expect(discoverEntry(dir, "custom/main.ts")).toBe(
      join(dir, "custom/main.ts")
    );
  });

  it("accepts an absolute --entry override", ({ projects }) => {
    const dir = makeProject(projects, ["custom/main.ts"]);
    const absolute = join(dir, "custom/main.ts");
    expect(discoverEntry(dir, absolute)).toBe(absolute);
  });

  it("throws when the --entry override does not exist", ({ projects }) => {
    const dir = makeProject(projects, []);
    expect(() => discoverEntry(dir, "nope.ts")).toThrow(/Entry not found/);
  });

  it("throws listing every candidate when none is found", ({ projects }) => {
    const dir = makeProject(projects, []);
    expect(() => discoverEntry(dir)).toThrow(
      /src\/index\.ts, src\/index\.tsx, src\/server\.ts, src\/server\.tsx, index\.ts, index\.tsx, server\.ts, server\.tsx/
    );
  });
});
