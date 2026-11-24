/**
 * Eval suite files: one YAML (or JSON) document per suite.
 *
 * Cloud owns the format: `push` sends each file's text, and Cloud parses and
 * validates every file before writing any, then creates or updates the suite
 * its `id` (UUID or slug) names. `export` writes the file Cloud renders. So the
 * CLI only finds and reads files; see the evals reference for the format.
 */
import { readFile } from "node:fs/promises";

import { UsageError } from "../../core/errors.js";

/** Largest suite file Cloud accepts. */
const MAX_BYTES = 256 * 1024;
/** Agent harnesses `evals options --harness` filters by. */
export const HARNESSES = ["pi", "codex", "claude-code", "cursor"] as const;

/** A suite file's path and text, as `push` sends it. */
export type SuiteFileText = { path: string; content: string };

/** Read one suite file; Cloud validates its contents. */
export async function readSuiteFile(path: string): Promise<SuiteFileText> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new UsageError(`Could not read ${path}.`);
  }
  if (Buffer.byteLength(content) > MAX_BYTES)
    throw new UsageError(`${path}: a suite file must be at most 256 KiB.`);
  return { path, content };
}
