import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectRoot } from "../src/bin/project-root.js";

const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-use-project-root-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveProjectRoot", () => {
  it("resolves a relative project path", () => {
    const parent = temporaryDir();
    const project = join(parent, "project");
    mkdirSync(project);
    expect(resolveProjectRoot(parent, "project")).toBe(
      process.platform === "win32"
        ? realpathSync.native(project)
        : resolve(parent, "project")
    );
  });

  it("preserves missing paths so existing command errors still apply", () => {
    const missing = join(temporaryDir(), "nonexistent");
    expect(resolveProjectRoot(missing)).toBe(resolve(missing));
  });

  it.skipIf(process.platform === "win32")(
    "does not resolve Unix symlinks",
    () => {
      const parent = temporaryDir();
      mkdirSync(join(parent, "actual"));
      symlinkSync("actual", join(parent, "link"), "dir");
      expect(resolveProjectRoot(join(parent, "link"))).toBe(
        join(parent, "link")
      );
    }
  );

  it.skipIf(process.platform !== "win32")(
    "canonicalizes Windows paths before watching files",
    async () => {
      // GitHub's Windows runner typically uses an 8.3 path in TEMP (RUNNER~1).
      const shortPath = temporaryDir();
      const root = resolveProjectRoot(shortPath);
      expect(root).toBe(realpathSync.native(shortPath));
      if (/~\d+(?=[\\/]|$)/.test(shortPath)) {
        expect(root).not.toMatch(/~\d+(?=[\\/]|$)/);
      }

      const watcher = watch(root, { recursive: true });
      try {
        await new Promise<void>((finish, fail) => {
          const timeout = setTimeout(
            () => fail(new Error("Windows file watcher did not fire")),
            10000
          );
          watcher.once("change", () => {
            clearTimeout(timeout);
            finish();
          });
          watcher.once("error", (error) => {
            clearTimeout(timeout);
            fail(error);
          });
          writeFileSync(join(shortPath, "changed.txt"), "test");
        });
      } finally {
        watcher.close();
      }
    }
  );
});
