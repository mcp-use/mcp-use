import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the built CLI (`pnpm build` first), like the scaffold e2e check.
const cli = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

describe("scaffolding with a template that can't be used", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "create-mcp-use-app-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it.each([
    ["nope", 'Template "nope" not found!'],
    ["bad name!", "Invalid template name"],
  ])(
    "exits without creating the project directory for --template %j",
    (template, expectedError) => {
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "my-project",
          "--template",
          template,
          "--dev",
          "--no-install",
          "--no-skills",
        ],
        { cwd, encoding: "utf8" }
      );

      // Checking the message also rules out a pass caused by a missing build.
      expect(result.stderr).toContain(expectedError);
      expect(result.status).toBe(1);
      expect(existsSync(join(cwd, "my-project"))).toBe(false);
    }
  );
});
