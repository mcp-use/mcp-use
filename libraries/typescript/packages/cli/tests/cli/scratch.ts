import { mkdirSync, mkdtempSync, realpathSync, rmdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scratchRoot = join(dirname(fileURLToPath(import.meta.url)), ".tmp");

/** Allocate a root owned by this invocation, without sharing mutable projects. */
export function createScratchRun(): string {
  // Another invocation may remove the empty parent between mkdir and mkdtemp.
  for (;;) {
    mkdirSync(scratchRoot, { recursive: true });
    try {
      return realpathSync.native(mkdtempSync(join(scratchRoot, "run-")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** Delete only this invocation's files, then remove the shared parent if empty. */
export async function removeScratchRun(root: string): Promise<void> {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
  try {
    rmdirSync(dirname(root));
  } catch (error) {
    // An active sibling run (or a leftover from an older version) owns the rest.
    if (
      !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
        (error as NodeJS.ErrnoException).code ?? ""
      )
    ) {
      throw error;
    }
  }
}
