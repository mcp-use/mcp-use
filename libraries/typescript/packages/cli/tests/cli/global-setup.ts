import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { createScratchRun, removeScratchRun } from "./scratch.js";

/** The runner owns a final sweep, including projects left by failed workers. */
export default async function setup(
  project: TestProject
): Promise<() => Promise<void>> {
  const root = createScratchRun();
  let externalRoot: string;
  try {
    externalRoot = mkdtempSync(join(tmpdir(), "mcp-use-cli-run-"));
  } catch (error) {
    await removeScratchRun(root);
    throw error;
  }
  project.provide("cliScratchRoot", root);
  project.provide("cliExternalScratchRoot", externalRoot);
  return async () => {
    if (
      existsSync(join(root, ".cleanup-incomplete")) ||
      existsSync(join(externalRoot, ".cleanup-incomplete"))
    ) {
      throw new Error(
        `Test resources did not stop; retained ${root} and ${externalRoot}`
      );
    }
    if (process.env.KEEP_TEST_PROJECTS === "1") {
      console.log(`[cli-tests] retained projects: ${root} and ${externalRoot}`);
    } else {
      await Promise.all([
        removeScratchRun(root),
        rm(externalRoot, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        }),
      ]);
    }
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    cliScratchRoot: string;
    cliExternalScratchRoot: string;
  }
}
