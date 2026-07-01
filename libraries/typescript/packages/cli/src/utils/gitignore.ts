import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Entries that must always be present in a project's `.gitignore`. The build
 * output and all runtime/cloud state now live under the single `.mcp-use/`
 * workspace, so `dist` is no longer produced and is intentionally absent.
 */
const REQUIRED_IGNORES = ["node_modules", ".env", ".env.local", ".mcp-use"];

/**
 * Ensure every {@link REQUIRED_IGNORES} entry is present in `<cwd>/.gitignore`.
 *
 * This is the single writer of the project `.gitignore` across the CLI — both
 * `deploy` and `saveProjectLink` route through it so there is exactly one
 * implementation guaranteeing `.mcp-use` (and secrets) stay ignored.
 */
export async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, ".gitignore");
  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    // file doesn't exist yet
  }
  const missing = REQUIRED_IGNORES.filter((entry) => !content.includes(entry));
  if (missing.length > 0) {
    const additions = missing.join("\n");
    const newContent =
      content + (content.endsWith("\n") ? "" : "\n") + additions + "\n";
    await fs.writeFile(gitignorePath, newContent, "utf-8");
  }
}
