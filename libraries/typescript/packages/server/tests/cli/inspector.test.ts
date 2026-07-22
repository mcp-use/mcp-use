import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { loadProjectInspector } from "../../src/cli/inspector.js";

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
  it("loads the framework Inspector when the project has no direct override", async () => {
    const cwd = await projectWithInspector();
    await expect(loadProjectInspector(cwd)).resolves.toMatchObject({
      installed: true,
    });
  });

  it("loads mountInspector from the project's dependency graph", async () => {
    const cwd = await projectWithInspector(
      "export const mountInspector = () => async () => new Response('mounted')\n"
    );
    const loaded = await loadProjectInspector(cwd);
    expect(loaded.installed).toBe(true);
    if (!loaded.installed)
      throw new Error("expected Inspector to be installed");

    const handler = loaded.module.mountInspector({
      basePath: "/mcp",
      autoConnectUrl: "http://localhost:3000/mcp",
      oauthProxyAllowLoopback: true,
      devMode: true,
    });
    await expect(
      handler(new Request("http://localhost/test"))
    ).resolves.toMatchObject({ status: 200 });
  });

  it("supports a root-only project override", async () => {
    const cwd = await projectWithInspector(
      "export const mountInspector = () => async () => new Response('mounted')\n",
      '"./index.js"'
    );
    await expect(loadProjectInspector(cwd)).resolves.toMatchObject({
      installed: true,
    });
  });

  it("rejects an installed package without the v2 mount contract", async () => {
    const cwd = await projectWithInspector("export const other = true\n");
    await expect(loadProjectInspector(cwd)).rejects.toThrow(
      "does not export mountInspector"
    );
  });
});
