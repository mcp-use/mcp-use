import type { TestProject } from "vitest/node";
import { createScratchRun, removeScratchRun } from "./scratch.js";

/** The runner owns a final sweep, including projects left by failed workers. */
export default function setup(project: TestProject): () => Promise<void> {
  const root = createScratchRun();
  project.provide("cliScratchRoot", root);
  return async () => {
    if (process.env.KEEP_TEST_PROJECTS === "1") {
      console.log(`[cli-tests] retained projects: ${root}`);
    } else {
      await removeScratchRun(root);
    }
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    cliScratchRoot: string;
  }
}
