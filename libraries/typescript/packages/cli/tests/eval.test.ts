import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readEvalSpecFile,
  resolveEvalSpecFiles,
  validateEvalSpecFiles,
} from "../src/commands/eval.js";

describe("eval command helpers", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = path.join(
      tmpdir(),
      `mcp-eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(path.join(projectDir, "evals", "nested"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("expands mcp-use.json style eval spec globs", async () => {
    const specPath = path.join(projectDir, "evals", "nested", "smoke.yaml");
    await writeFile(
      specPath,
      "apiVersion: mcp-use.dev/eval/v1\nname: smoke\ntests:\n  - type: protocol\n    name: tools\n    method: tools/list\n"
    );

    await writeFile(path.join(projectDir, "evals", "ignore.txt"), "nope");

    const files = await resolveEvalSpecFiles(projectDir, ["evals/**/*.yaml"]);

    expect(files).toEqual([specPath]);
  });

  it("validates YAML eval specs", async () => {
    const specPath = path.join(projectDir, "evals", "smoke.yaml");
    await writeFile(
      specPath,
      [
        "apiVersion: mcp-use.dev/eval/v1",
        "name: smoke",
        "tests:",
        "  - type: tool",
        "    name: hello",
        "    tool: hello",
        "    input:",
        "      name: Ada",
      ].join("\n")
    );

    const result = await readEvalSpecFile(specPath);

    expect(result.ok).toBe(true);
    expect(result.spec?.tests[0]).toMatchObject({
      type: "tool",
      tool: "hello",
    });
  });

  it("returns invalid files in validation reports", async () => {
    const specPath = path.join(projectDir, "evals", "bad.yaml");
    await writeFile(specPath, "apiVersion: nope\nname: bad\ntests: []\n");

    const report = await validateEvalSpecFiles([specPath]);

    expect(report.ok).toBe(false);
    expect(report.invalid).toBe(1);
    expect(report.files[0].error).toMatch(/apiVersion|tests/);
  });
});
