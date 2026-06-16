import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TaskConfigSchema, type LoadedTask } from "./types.js";

const EVALS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TASKS_DIR = join(EVALS_ROOT, "tasks");
export const RESULTS_DIR = join(EVALS_ROOT, "results");
/** repo-root skills/mcp-builder — the content injected for skill-on variants */
export const SKILL_DIR = join(
  EVALS_ROOT,
  "..",
  "..",
  "..",
  "skills",
  "mcp-builder"
);

export async function listTaskIds(): Promise<string[]> {
  const entries = await readdir(TASKS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function loadTask(id: string): Promise<LoadedTask> {
  const dir = join(TASKS_DIR, id);
  const parsed = TaskConfigSchema.safeParse(
    JSON.parse(await readFile(join(dir, "task.json"), "utf8"))
  );
  if (!parsed.success) {
    throw new Error(
      `invalid ${join(dir, "task.json")}:\n${z.prettifyError(parsed.error)}`
    );
  }
  const config = { ...parsed.data, id };
  const prompt = await readFile(join(dir, "prompt.md"), "utf8");
  const promptHash = createHash("sha256")
    .update(prompt)
    .digest("hex")
    .slice(0, 12);
  return { config, prompt, promptHash, dir };
}
