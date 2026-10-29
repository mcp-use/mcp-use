import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

// A DOS 8.3 short-name segment, such as PROGRA~1 or 98BD~1.
const WINDOWS_SHORT_NAME_SEGMENT = /~\d+(?:\.[^\\/]{1,3})?(?=[\\/]|$)/;

/**
 * Expand Windows DOS 8.3 names before passing the project root to Vite.
 * libuv's fs watcher may assert if the watched directory uses short names
 * while Windows reports changes using long names (mcp-use/mcp-use#2961).
 */
export function resolveProjectRoot(cwd: string, projectPath = "."): string {
  const root = resolve(cwd, projectPath);
  if (process.platform !== "win32" || !WINDOWS_SHORT_NAME_SEGMENT.test(root)) {
    return root;
  }

  try {
    return realpathSync.native(root);
  } catch {
    // Let commands handle missing/inaccessible roots as they did before.
    return root;
  }
}

/** Preserve relative CLI options; normalize only short absolute Windows paths. */
export function resolveAbsoluteProjectPath(path: string): string {
  if (process.platform !== "win32" || !isAbsolute(path)) return path;
  return resolveProjectRoot(path);
}
