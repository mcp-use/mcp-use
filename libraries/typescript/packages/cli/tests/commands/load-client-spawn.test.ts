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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { spawnAndWait } from "../../src/commands/load-client.js";

// Like the real npm and pnpm shims, the fake hands its arguments to Node, so
// the test sees exactly the argv a package manager would receive. On Windows
// that argv comes from `cmd.exe` parsing the command line; elsewhere
// spawnAndWait runs without a shell and the argv is forwarded unchanged.
const RECORDER = [
  'const { writeFileSync } = require("node:fs");',
  'writeFileSync("args.json", JSON.stringify(process.argv.slice(2)));',
].join("\n");

function installFakePackageManager(binDir: string, name: string): void {
  writeFileSync(join(binDir, "record-args.cjs"), RECORDER);
  if (process.platform === "win32") {
    writeFileSync(
      join(binDir, `${name}.cmd`),
      `@echo off\r\nnode "%~dp0record-args.cjs" %*\r\n`
    );
    return;
  }
  const path = join(binDir, name);
  writeFileSync(
    path,
    `#!/bin/sh\nexec node "$(dirname "$0")/record-args.cjs" "$@"\n`
  );
  chmodSync(path, 0o755);
}

describe("spawnAndWait (real processes)", () => {
  let dir: string;
  let binDir: string;
  let projectDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-use-cli-spawn-"));
    binDir = join(dir, "bin");
    projectDir = join(dir, "project");
    mkdirSync(binDir);
    mkdirSync(projectDir);
    vi.stubEnv("PATH", `${binDir}${delimiter}${process.env.PATH ?? ""}`);
    installFakePackageManager(binDir, "fake-pm");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  function recordedArgs(): string[] {
    return JSON.parse(
      readFileSync(join(projectDir, "args.json"), "utf8")
    ) as string[];
  }

  it("passes a caret version range to the package manager unchanged", async () => {
    const code = await spawnAndWait(
      "fake-pm",
      ["install", "@mcp-use/client@^2.0.0-alpha.0"],
      projectDir
    );

    expect(code).toBe(0);
    expect(recordedArgs()).toEqual([
      "install",
      "@mcp-use/client@^2.0.0-alpha.0",
    ]);
  });

  it("passes a range with || as one argument", async () => {
    const dependency = "@mcp-use/client@^2.0.1 || ^2.1.0";

    const code = await spawnAndWait("fake-pm", ["add", dependency], projectDir);

    expect(code).toBe(0);
    expect(recordedArgs()).toEqual(["add", dependency]);
  });
});
