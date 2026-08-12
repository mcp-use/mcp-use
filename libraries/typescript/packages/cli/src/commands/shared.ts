import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { openBrowser as launchBrowser } from "../cli/open-browser.js";

/** Usage error reported with exit code 2 by the CLI boundary. */
export class UsageError extends Error {
  /** Process exit code for malformed command lines. */
  readonly exitCode = 2;
}

/** Operational error reported with exit code 1 by the CLI boundary. */
export class CommandError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;
  /** Optional structured diagnostic details. */
  readonly details: unknown;

  /**
   * Create an operational CLI failure.
   *
   * @param code - Stable machine-readable code.
   * @param message - Human-readable failure description.
   * @param details - Optional structured diagnostics.
   */
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** Operational error that represents a missing or invalid CLI choice. */
export class CommandUsageError extends CommandError {
  /** Process exit code for command choices that must be supplied explicitly. */
  readonly exitCode = 2;
}

/** Whether a command should emit machine-readable output. */
export function wantsJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

/** Emit one successful human or JSON result. */
export function printResult(
  value: unknown,
  json: boolean,
  human?: string
): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } else if (human !== undefined) {
    process.stdout.write(`${human}\n`);
  } else if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

/** Report a command error using the CLI's text or JSON convention. */
export function reportError(error: unknown, json: boolean): number {
  const usage =
    error instanceof UsageError ||
    (error instanceof CommandError &&
      "exitCode" in error &&
      error.exitCode === 2);
  const operational = error instanceof CommandError;
  const code = operational
    ? error.code
    : usage
      ? "usage_error"
      : "command_failed";
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    process.stderr.write(
      `${JSON.stringify({
        error: {
          code,
          message,
          ...(operational && error.details !== undefined
            ? { details: error.details }
            : {}),
        },
      })}\n`
    );
  } else {
    process.stderr.write(`${message}\n`);
    if (operational && hasNextSteps(error.details)) {
      for (const step of error.details.nextSteps) {
        process.stderr.write(`\n${step.description}:\n  ${step.command}\n`);
      }
    }
  }
  return usage ? 2 : 1;
}

function hasNextSteps(value: unknown): value is {
  nextSteps: Array<{ description: string; command: string }>;
} {
  if (value === null || typeof value !== "object") return false;
  const steps = (value as { nextSteps?: unknown }).nextSteps;
  return (
    Array.isArray(steps) &&
    steps.every(
      (step) =>
        step !== null &&
        typeof step === "object" &&
        typeof (step as { description?: unknown }).description === "string" &&
        typeof (step as { command?: unknown }).command === "string"
    )
  );
}

/** Require confirmation for destructive operations. */
export async function confirm(
  message: string,
  options: { yes: boolean; json: boolean }
): Promise<boolean> {
  if (options.yes) return true;
  if (options.json || !process.stdin.isTTY) {
    throw new UsageError(`${message} Pass --yes to confirm.`);
  }
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    return answer.trim().toLowerCase() === "y";
  } finally {
    prompt.close();
  }
}

/** Best-effort dependency-free browser opener. */
export function openBrowser(url: string): void {
  launchBrowser(url);
}

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

/** Remove a private state file idempotently. */
export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Global mcp-use state directory. */
export const GLOBAL_STATE_DIR = join(homedir(), ".mcp-use");
