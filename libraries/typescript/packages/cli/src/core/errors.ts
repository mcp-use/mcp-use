/** A command the caller can run next, shown with an error. */
export interface NextStep {
  /** What running `command` does, e.g. "List deployments". */
  description: string;
  /** A complete command line, e.g. `mcp-use deployments list --json`. */
  command: string;
}

/**
 * Usage error reported with exit code 2 by the CLI boundary: a missing or
 * malformed argument, or an input the CLI would have to prompt for without a
 * TTY. The message names the flag or argument to pass.
 */
export class UsageError extends Error {
  /** Process exit code for malformed command lines. */
  readonly exitCode = 2;
  /** Stable machine-readable error code. */
  readonly code: string;
  /** Commands that would succeed instead. */
  readonly nextSteps: readonly NextStep[];

  /**
   * Create a usage failure.
   *
   * @param message - What is missing or wrong, naming the flag to pass.
   * @param options - A more specific `code` than `usage_error`, and next steps.
   */
  constructor(
    message: string,
    options: { code?: string; nextSteps?: readonly NextStep[] } = {}
  ) {
    super(message);
    this.code = options.code ?? "usage_error";
    this.nextSteps = options.nextSteps ?? [];
  }
}

/** Operational error reported with exit code 1 by the CLI boundary. */
export class CommandError extends Error {
  /** Stable machine-readable code. Callers branch on this, not the message. */
  readonly code: string;
  /** Optional structured diagnostic details. */
  readonly details: unknown;
  /** Commands that may resolve the failure. */
  readonly nextSteps: readonly NextStep[];

  /**
   * Create an operational CLI failure.
   *
   * @param code - Stable machine-readable code.
   * @param message - Human-readable failure description.
   * @param details - Optional structured diagnostics.
   * @param nextSteps - Commands that may resolve the failure.
   */
  constructor(
    code: string,
    message: string,
    details?: unknown,
    nextSteps: readonly NextStep[] = []
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.nextSteps = nextSteps;
  }
}
