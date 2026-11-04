import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { loadProjectInspector } from "../../src/toolchain/inspector.js";

const temporaryDirectories: string[] = [];

async function projectWithInspector(
  source?: string,
  exportsMap = '{".":"./index.js"}'
): Promise<string> {
  const cwd = join(
    tmpdir(),
    `mcp-use-inspector-loader-${process.pid}-${Date.now()}-${temporaryDirectories.length}`
  );
  temporaryDirectories.push(cwd);
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    source === undefined
      ? '{"type":"module"}\n'
      : '{"type":"module","devDependencies":{"@mcp-use/inspector":"test"}}\n'
  );
  if (source !== undefined) {
    const packageRoot = join(cwd, "node_modules", "@mcp-use", "inspector");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      `{"name":"@mcp-use/inspector","type":"module","exports":${exportsMap}}\n`
    );
    await writeFile(join(packageRoot, "index.js"), source);
  }
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("loadProjectInspector", () => {
  it("rejects an installed package without the v2 mount contract", async () => {
    const cwd = await projectWithInspector("export const other = true\n");
    await expect(loadProjectInspector(cwd)).rejects.toThrow(
      "does not export mountInspector"
    );
  });
});
