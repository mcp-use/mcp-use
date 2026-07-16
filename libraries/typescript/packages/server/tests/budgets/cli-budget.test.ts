import { readdir, readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const DIST = new URL("../../dist/", import.meta.url);

describe("published CLI boundaries", () => {
  it("keeps library and start static graphs free of command/toolchain imports", async () => {
    const index = await readFile(new URL("index.js", DIST), "utf8");
    const start = await readFile(new URL("commands/start.js", DIST), "utf8");

    for (const source of [index, start]) {
      expect(source).not.toMatch(/\bfrom\s+["'][^"']*commands\//);
      expect(source).not.toMatch(/\bfrom\s+["'](?:vite|@vitejs\/)/);
      expect(source).not.toMatch(/\bimport\s+["'](?:vite|@vitejs\/)/);
    }
  });

  it("dispatches every substantial command through a dynamic chunk", async () => {
    const bin = await readFile(new URL("bin.js", DIST), "utf8");
    for (const command of [
      "start",
      "dev",
      "build",
      "identity",
      "organizations",
      "servers",
      "deployments",
      "deploy",
      "client",
      "screenshot",
      "skills",
    ]) {
      expect(bin).toContain(`import("./commands/${command}.js")`);
    }
  });

  it("keeps the unpacked framework artifact below five MiB", async () => {
    expect(await directoryBytes(DIST)).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});

async function directoryBytes(directory: URL): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      bytes += await directoryBytes(new URL(`${entry.name}/`, directory));
    } else {
      bytes += (await stat(path)).size;
    }
  }
  return bytes;
}
