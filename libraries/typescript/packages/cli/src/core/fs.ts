import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CommandError } from "./errors.js";

/** Check whether a filesystem path exists. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Read JSON, returning `fallback` when the file does not exist. */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new CommandError("invalid_state", `Could not read ${path}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Atomically write JSON with private directory/file permissions. */
export async function writePrivateJson(
  path: string,
  value: unknown
): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/** Global mcp-use state directory. */
export const GLOBAL_STATE_DIR = join(homedir(), ".mcp-use");
