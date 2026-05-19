import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Regression test: a widget that fails to build must fail the whole
 * `mcp-use build` with a non-zero exit code. Previously, failures were
 * swallowed into a `null` and the command printed "✓ Build complete!"
 * and exited 0 — so CI would happily ship a manifest with zero widgets.
 */

const CLI_PATH = join(__dirname, "../dist/index.cjs");

function runCLI(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Command timeout"));
    }, 60000);
    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("mcp-use build — widget failures", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "mcp-cli-build-fail-"));

    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify(
        {
          name: "build-failure-fixture",
          version: "0.0.0",
          type: "module",
        },
        null,
        2
      )
    );

    writeFileSync(
      join(projectDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          esModuleInterop: true,
          skipLibCheck: true,
        },
      })
    );

    const resourcesDir = join(projectDir, "resources");
    mkdirSync(resourcesDir, { recursive: true });

    // A widget that imports a package that doesn't exist — guaranteed to
    // fail the Vite build regardless of the environment.
    writeFileSync(
      join(resourcesDir, "broken.tsx"),
      `import "this-module-does-not-exist-${Math.random().toString(36).slice(2)}";
export default function Broken() { return null; }
`
    );
  });

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("exits non-zero when a widget fails to build", async () => {
    const result = await runCLI(["build"], projectDir);

    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Failed to build broken/i);
    expect(combined).toMatch(/widget\(s\) failed to build/i);
    // Must NOT claim success
    expect(combined).not.toMatch(/Build complete/i);
  }, 90000);
});
