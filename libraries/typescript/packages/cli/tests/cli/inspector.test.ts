import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { it } from "../support/fixtures.js";
import type { TestScope } from "../support/scope.js";

import { loadProjectInspector } from "../../src/cli/inspector.js";

async function projectWithInspector(
  scope: TestScope,
  source?: string,
  exportsMap = '{".":"./index.js"}'
): Promise<string> {
  const cwd = scope.directory("inspector-");
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

describe("loadProjectInspector", () => {
  it("loads the framework Inspector when the project has no direct override", async ({
    scope,
  }) => {
    const cwd = await projectWithInspector(scope);
    await expect(loadProjectInspector(cwd)).resolves.toMatchObject({
      installed: true,
    });
  });

  it("loads mountInspector from the project's dependency graph", async ({
    scope,
  }) => {
    const cwd = await projectWithInspector(
      scope,
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

  it("supports a root-only project override", async ({ scope }) => {
    const cwd = await projectWithInspector(
      scope,
      "export const mountInspector = () => async () => new Response('mounted')\n",
      '"./index.js"'
    );
    await expect(loadProjectInspector(cwd)).resolves.toMatchObject({
      installed: true,
    });
  });

  it("rejects an installed package without the v2 mount contract", async ({
    scope,
  }) => {
    const cwd = await projectWithInspector(
      scope,
      "export const other = true\n"
    );
    await expect(loadProjectInspector(cwd)).rejects.toThrow(
      "does not export mountInspector"
    );
  });
});
