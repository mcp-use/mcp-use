import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { runPackageManager } from "../utils.js";

// npm and pnpm are installed as .cmd shims on Windows and as executable
// scripts elsewhere. The fake records its arguments in the working directory.
function installFakePackageManager(binDir: string, name: string): void {
  if (process.platform === "win32") {
    writeFileSync(
      join(binDir, `${name}.cmd`),
      "@echo off\r\necho %*> args.txt\r\n"
    );
    return;
  }
  const script = join(binDir, name);
  writeFileSync(script, '#!/bin/sh\necho "$@" > args.txt\n');
  chmodSync(script, 0o755);
}

describe("runPackageManager (real processes)", () => {
  let dir: string;
  let binDir: string;
  let projectDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "create-mcp-use-app-pm-"));
    binDir = join(dir, "bin");
    projectDir = join(dir, "project");
    mkdirSync(binDir);
    mkdirSync(projectDir);
    vi.stubEnv("PATH", `${binDir}${delimiter}${process.env.PATH ?? ""}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs a package manager installed as a shim in the project directory", async () => {
    installFakePackageManager(binDir, "fake-pm");

    await runPackageManager("fake-pm", ["install"], projectDir);

    expect(readFileSync(join(projectDir, "args.txt"), "utf8").trim()).toBe(
      "install"
    );
  });

  it("rejects when the package manager is not installed", async () => {
    await expect(
      runPackageManager("mcp-use-missing-pm", ["install"], projectDir)
    ).rejects.toThrow();
  });
});
