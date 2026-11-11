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

interface FakeScript {
  /** Body of the Windows `.cmd` shim. */
  cmd: string;
  /** Body of the POSIX `sh` script. */
  sh: string;
}

// npm and pnpm are installed as .cmd shims on Windows and as executable
// scripts elsewhere.
function installFakePackageManager(
  binDir: string,
  name: string,
  script: FakeScript
): void {
  if (process.platform === "win32") {
    writeFileSync(
      join(binDir, `${name}.cmd`),
      `@echo off\r\n${script.cmd}\r\n`
    );
    return;
  }
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\n${script.sh}\n`);
  chmodSync(path, 0o755);
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
    // The fake records its arguments in the working directory.
    installFakePackageManager(binDir, "fake-pm", {
      cmd: "echo %*> args.txt",
      sh: 'echo "$@" > args.txt',
    });

    await runPackageManager("fake-pm", ["install"], projectDir);

    expect(readFileSync(join(projectDir, "args.txt"), "utf8").trim()).toBe(
      "install"
    );
  });

  it("rejects with the package manager's stderr when it exits non-zero", async () => {
    installFakePackageManager(binDir, "fake-pm", {
      cmd: "echo lockfile is broken 1>&2\r\nexit /b 1",
      sh: 'echo "lockfile is broken" >&2\nexit 1',
    });

    await expect(
      runPackageManager("fake-pm", ["install"], projectDir)
    ).rejects.toThrow(/fake-pm install failed:\s+lockfile is broken/);
  });

  it("rejects when the package manager is not installed", async () => {
    await expect(
      runPackageManager("mcp-use-missing-pm", ["install"], projectDir)
    ).rejects.toThrow();
  });
});
