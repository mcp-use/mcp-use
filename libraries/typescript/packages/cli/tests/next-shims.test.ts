import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectNextJsProject,
  loadNextJsEnvFiles,
} from "../src/utils/next-shims.js";

describe("detectNextJsProject", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = path.join(
      tmpdir(),
      `next-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("returns true when next is in dependencies", async () => {
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ dependencies: { next: "^15.0.0" } })
    );
    expect(await detectNextJsProject(projectDir)).toBe(true);
  });

  it("returns true when next is in devDependencies", async () => {
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ devDependencies: { next: "^15.0.0" } })
    );
    expect(await detectNextJsProject(projectDir)).toBe(true);
  });

  it("returns false when next is absent from both", async () => {
    await writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ dependencies: { react: "^19.0.0" } })
    );
    expect(await detectNextJsProject(projectDir)).toBe(false);
  });

  it("returns false when package.json is missing", async () => {
    expect(await detectNextJsProject(projectDir)).toBe(false);
  });

  it("returns false when package.json is invalid JSON", async () => {
    await writeFile(path.join(projectDir, "package.json"), "not json");
    expect(await detectNextJsProject(projectDir)).toBe(false);
  });
});

describe("loadNextJsEnvFiles", () => {
  let projectDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    projectDir = path.join(
      tmpdir(),
      `next-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(projectDir, { recursive: true });

    // Save env vars we'll touch so we can restore them
    for (const key of ["TEST_VAR_A", "TEST_VAR_B", "TEST_VAR_OVERRIDE"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
    // Restore original env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("loads variables from .env", async () => {
    await writeFile(path.join(projectDir, ".env"), "TEST_VAR_A=from-env\n");
    await loadNextJsEnvFiles(projectDir);
    expect(process.env.TEST_VAR_A).toBe("from-env");
  });

  it("later files in the cascade override earlier ones", async () => {
    await writeFile(path.join(projectDir, ".env"), "TEST_VAR_OVERRIDE=base\n");
    await writeFile(
      path.join(projectDir, ".env.development"),
      "TEST_VAR_OVERRIDE=dev\n"
    );
    await writeFile(
      path.join(projectDir, ".env.local"),
      "TEST_VAR_OVERRIDE=local\n"
    );
    await loadNextJsEnvFiles(projectDir);
    expect(process.env.TEST_VAR_OVERRIDE).toBe("local");
  });

  it(".env.development.local wins over all others", async () => {
    await writeFile(path.join(projectDir, ".env"), "TEST_VAR_OVERRIDE=base\n");
    await writeFile(
      path.join(projectDir, ".env.local"),
      "TEST_VAR_OVERRIDE=local\n"
    );
    await writeFile(
      path.join(projectDir, ".env.development.local"),
      "TEST_VAR_OVERRIDE=dev-local\n"
    );
    await loadNextJsEnvFiles(projectDir);
    expect(process.env.TEST_VAR_OVERRIDE).toBe("dev-local");
  });

  it("does not crash when no .env files exist", async () => {
    await expect(loadNextJsEnvFiles(projectDir)).resolves.toBeUndefined();
  });

  it("loads from multiple files independently", async () => {
    await writeFile(path.join(projectDir, ".env"), "TEST_VAR_A=a\n");
    await writeFile(
      path.join(projectDir, ".env.development"),
      "TEST_VAR_B=b\n"
    );
    await loadNextJsEnvFiles(projectDir);
    expect(process.env.TEST_VAR_A).toBe("a");
    expect(process.env.TEST_VAR_B).toBe("b");
  });
});
