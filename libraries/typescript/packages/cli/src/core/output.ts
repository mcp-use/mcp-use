import { CommandError, UsageError } from "./errors.js";

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
