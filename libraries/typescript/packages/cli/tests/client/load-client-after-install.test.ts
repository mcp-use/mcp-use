import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importInstalledClientModule } from "../../src/client/load-client.js";

// Adapted from the regression tests in mcp-use/mcp-use#2871.

/** A stand-in shaped like the published package: import-only `exports`. */
function installFakeClient(root: string): void {
  const packageDir = join(root, "node_modules", "@mcp-use", "client");
  mkdirSync(join(packageDir, "dist"), { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "@mcp-use/client",
      version: "0.0.0-test",
      type: "module",
      exports: { ".": { node: { import: "./dist/index.js" } } },
    })
  );
  writeFileSync(
    join(packageDir, "dist", "index.js"),
    'export const installedBy = "fake";\n'
  );
}

type FakeClient = { installedBy?: string };

describe("importInstalledClientModule", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "mcp-use-cli-after-install-"));
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "app", type: "module" })
    );
    // The CLI itself is installed in the same scope directory.
    mkdirSync(join(projectRoot, "node_modules", "@mcp-use", "cli"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("loads the copy installed after a failed import of the same package", async () => {
    // loadClientPackage first tries import("@mcp-use/client") from the
    // installed CLI. Run that failing import through Node's own loader (Vitest
    // does not transform files under node_modules): on Node 24 the miss is
    // cached and breaks later imports of the package name.
    const probe = join(
      projectRoot,
      "node_modules",
      "@mcp-use",
      "cli",
      "probe.mjs"
    );
    writeFileSync(
      probe,
      'try { await import("@mcp-use/client"); } catch {}\nexport {};\n'
    );
    await import(pathToFileURL(probe).href);

    installFakeClient(projectRoot);

    const mod = (await importInstalledClientModule(
      projectRoot
    )) as unknown as FakeClient;
    expect(mod.installedBy).toBe("fake");
  });

  it("loads a copy hoisted to a workspace root", async () => {
    const workspacePackage = join(projectRoot, "packages", "server");
    mkdirSync(workspacePackage, { recursive: true });
    writeFileSync(join(workspacePackage, "package.json"), "{}");
    installFakeClient(projectRoot);

    const mod = (await importInstalledClientModule(
      workspacePackage
    )) as unknown as FakeClient;
    expect(mod.installedBy).toBe("fake");
  });

  it("throws ERR_MODULE_NOT_FOUND when no copy is installed", async () => {
    await expect(
      importInstalledClientModule(projectRoot)
    ).rejects.toMatchObject({ code: "ERR_MODULE_NOT_FOUND" });
  });
});
