import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  resolveAbsoluteProjectPath,
  resolveProjectRoot,
} from "../src/bin/project-root.js";

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
    const dir = temporaryDir();
    const parent =
      process.platform === "win32" ? realpathSync.native(dir) : dir;
    const project = join(parent, "project");
    mkdirSync(project);
    expect(resolveProjectRoot(parent, "project")).toBe(
      resolve(parent, "project")
    );
  });

  it("preserves missing paths so existing command errors still apply", () => {
    const missing = join(temporaryDir(), "nonexistent");
    expect(resolveProjectRoot(missing)).toBe(resolve(missing));
  });

  it("preserves relative CLI paths", () => {
    for (const path of ["./src/index.ts", "views", "src/mcp"]) {
      expect(resolveAbsoluteProjectPath(path)).toBe(path);
    }
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
    "does not resolve Windows junctions without short path segments",
    () => {
      // Canonicalize the fixture parent so a short TEMP prefix cannot
      // accidentally trigger the 8.3 normalization under test.
      const parent = realpathSync.native(temporaryDir());
      mkdirSync(join(parent, "actual"));
      const link = join(parent, "link");
      symlinkSync(join(parent, "actual"), link, "junction");
      expect(resolveProjectRoot(link)).toBe(link);
      expect(resolveAbsoluteProjectPath(link)).toBe(link);
    }
  );

  it.skipIf(process.platform !== "win32")(
    "expands a real DOS 8.3 alias on Windows",
    ({ skip }) => {
      const longPath = realpathSync.native(temporaryDir());
      // cmd.exe expands %~fsI to the actual short-name alias.
      // TEMP itself may not contain a short path on every runner.
      const shortPath = execFileSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/c", 'for %I in ("%MCP_USE_TEST_PROJECT_DIR%") do @echo %~fsI'],
        {
          encoding: "utf8",
          env: { ...process.env, MCP_USE_TEST_PROJECT_DIR: longPath },
          windowsVerbatimArguments: true,
        }
      ).trim();
      // A malformed cmd.exe invocation must fail, never count as a skip.
      expect(existsSync(shortPath)).toBe(true);
      if (!/~\d+$/.test(basename(shortPath))) {
        skip(
          "DOS 8.3 aliases unavailable for this fixture (8dot3name may be disabled)"
        );
      }

      expect(resolveProjectRoot(shortPath)).toBe(longPath);
      expect(resolveProjectRoot(shortPath)).not.toBe(shortPath);
      expect(resolveAbsoluteProjectPath(shortPath)).toBe(longPath);
    }
  );
});
