import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Expand Windows DOS 8.3 names before passing the project root to Vite.
 * libuv's fs watcher may assert if the watched directory uses short names
 * while Windows reports changes using long names (mcp-use/mcp-use#2961).
 */
export function resolveProjectRoot(cwd: string, projectPath = "."): string {
  const root = resolve(cwd, projectPath);
  if (process.platform !== "win32") return root;

  try {
    return realpathSync.native(root);
  } catch {
    // Let commands handle missing/inaccessible roots as they did before.
    return root;
  }
}
