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
