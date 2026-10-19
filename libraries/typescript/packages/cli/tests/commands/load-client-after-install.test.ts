import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importProjectClientModule } from "../../src/commands/load-client.js";

// Writes a stand-in for the installed client SDK into the project, shaped like
// the published package: conditional `exports`, no `main`, no root index.js.
function installFakeClient(projectRoot: string): void {
  const packageDir = join(projectRoot, "node_modules", "@mcp-use", "client");
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
    'export class MCPClient {}\nexport const installedBy = "project";\n'
  );
}

describe("importProjectClientModule after auto-install", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "mcp-use-cli-after-install-"));
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "app", type: "module" })
    );
    // A real project already has @mcp-use/cli in this scope directory.
    mkdirSync(join(projectRoot, "node_modules", "@mcp-use", "cli"), {
      recursive: true,
    });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("loads the project's copy after a failed import of the same package", async () => {
    // Reproduce what loadClientPackage does before installing: an import of
    // @mcp-use/client from the installed CLI fails. The probe sits where the
    // CLI is installed so that Node's own loader (not Vitest's) runs it; on
    // Node 24 that failed lookup is what poisons later resolution.
    const probe = join(
      projectRoot,
      "node_modules",
      "@mcp-use",
      "cli",
      "probe.mjs"
    );
    writeFileSync(
      probe,
      'try { await import("@mcp-use/client"); } catch {}\nexport const probed = true;\n'
    );
    await import(pathToFileURL(probe).href);

    installFakeClient(projectRoot);

    const mod = (await importProjectClientModule(projectRoot)) as unknown as {
      installedBy?: string;
    };
    expect(mod.installedBy).toBe("project");
  });

  it("loads a copy hoisted to a workspace root's node_modules", async () => {
    // npm and yarn workspaces install a package's dependency at the root.
    const packageRoot = join(projectRoot, "packages", "server");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "server", type: "module" })
    );
    installFakeClient(projectRoot);

    const mod = (await importProjectClientModule(packageRoot)) as unknown as {
      installedBy?: string;
    };
    expect(mod.installedBy).toBe("project");
  });
});
