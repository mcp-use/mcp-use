/**
 * The conventions every cloud command follows. Agents are the CLI's main
 * users, so each command must be scriptable without a TTY and give output a
 * program can parse.
 *
 * - **`--json`:** stdout carries exactly one JSON value, on success and on
 *   failure. Nothing else is written to stdout. Progress, if any, goes to
 *   stderr.
 * - **Errors:** `{ "error": { code, message, nextSteps } }`, where `code` is a
 *   stable string callers branch on and each next step is
 *   `{ description, command }`. Without `--json` the message and next steps
 *   go to stderr.
 * - **Exit codes:** 0 success, 1 the command failed, 2 usage error.
 * - **Prompts:** never prompt without a TTY, or with `--json`. A missing input
 *   is a usage error that names the flag to pass (see `confirm` in
 *   `prompt.ts`).
 * - **Flags:** booleans are opt-in. `parseCommandArgs` rejects `--no-x`
 *   unless the command declares the pair, which is allowed only for saved
 *   settings that must be turned both ways.
 */
import { parseArgs, type ParseArgsConfig } from "node:util";

import { CommandError, UsageError, type NextStep } from "./errors.js";

/** Process exit codes. */
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

/** Writes a command's single result. */
interface CommandOutput {
  /** Whether `--json` was passed. */
  readonly json: boolean;
  /**
   * Write the command's result: `value` as one JSON document with `--json`,
   * otherwise `human`. A command calls this exactly once.
   */
  result(value: unknown, human: string): void;
}

/**
 * Run one command under the conventions above and return its exit code.
 *
 * `body` writes its result through `output.result`. Anything it throws is
 * reported as one error document: `UsageError` exits 2, everything else 1.
 */
export async function runCommand(
  argv: readonly string[],
  body: (output: CommandOutput) => Promise<void>
): Promise<number> {
  const json = argv.includes("--json");
  let written = false;
  const output: CommandOutput = {
    json,
    result(value, human) {
      if (written) {
        throw new Error("A command wrote more than one result.");
      }
      written = true;
      process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${human}\n`);
    },
  };
  try {
    await body(output);
    return EXIT_SUCCESS;
  } catch (error) {
    return reportFailure(error, json);
  }
}

/**
 * Parse a command's arguments with `node:util`'s strict parser. A malformed
 * command line becomes a `UsageError`. `positionals` is the exact number of
 * positional arguments the command takes, and `usage` the usage line shown
 * when that number is wrong.
 */
export function parseCommandArgs<
  const Options extends NonNullable<ParseArgsConfig["options"]>,
>(
  argv: readonly string[],
  spec: {
    options: Options;
    positionals: number;
    usage: string;
    nextSteps?: readonly NextStep[];
  }
) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: spec.options,
      allowPositionals: spec.positionals > 0,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(
      `${error instanceof Error ? error.message : String(error)}\nUsage: ${spec.usage}`,
      { nextSteps: spec.nextSteps ?? [] }
    );
  }
  if (parsed.positionals.length !== spec.positionals) {
    throw new UsageError(`Usage: ${spec.usage}`, {
      nextSteps: spec.nextSteps ?? [],
    });
  }
  return parsed;
}

/** Write `error` as the command's one failure report; return the exit code. */
function reportFailure(error: unknown, json: boolean): number {
  const usage = error instanceof UsageError || isLegacyUsageError(error);
  const known = error instanceof UsageError || error instanceof CommandError;
  const document = {
    code: known ? error.code : "internal_error",
    message: error instanceof Error ? error.message : String(error),
    nextSteps: known ? nextStepsOf(error) : [],
  };
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: document })}\n`);
  } else {
    process.stderr.write(`${document.message}\n`);
    for (const step of document.nextSteps) {
      process.stderr.write(`\n${step.description}:\n  ${step.command}\n`);
    }
  }
  return usage ? EXIT_USAGE : EXIT_FAILURE;
}

/** `CommandUsageError` and similar: a `CommandError` that exits 2. */
function isLegacyUsageError(error: unknown): boolean {
  return (
    error instanceof CommandError &&
    "exitCode" in error &&
    error.exitCode === EXIT_USAGE
  );
}

/**
 * Next steps of a known error. Errors from the pre-convention cloud client
 * carry them in `details.nextSteps`.
 */
function nextStepsOf(error: UsageError | CommandError): readonly NextStep[] {
  if (error.nextSteps.length > 0 || !(error instanceof CommandError)) {
    return error.nextSteps;
  }
  const legacy = (error.details as { nextSteps?: unknown } | undefined)
    ?.nextSteps;
  return Array.isArray(legacy) ? (legacy as NextStep[]) : [];
}
