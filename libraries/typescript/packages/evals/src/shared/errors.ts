/**
 * Base error class for all eval-related errors.
 */
export class BaseEvalError extends Error {
  /** Error code for programmatic handling */
  readonly code: string;

  /**
   * Create a BaseEvalError.
   *
   * @param message - Error message
   * @param code - Error code (defaults to "EVAL_ERROR")
   * @param cause - Optional underlying error cause
   */
  constructor(message: string, code = "EVAL_ERROR", cause?: unknown) {
    super(message);
    this.name = "BaseEvalError";
    this.code = code;
    if (cause) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Error thrown when eval configuration is invalid or cannot be loaded.
 *
 * @example
 * ```typescript
 * throw new EvalConfigError("ANTHROPIC_API_KEY is required");
 * ```
 */
export class EvalConfigError extends BaseEvalError {
  constructor(message: string, cause?: unknown) {
    super(message, "EVAL_CONFIG_ERROR", cause);
    this.name = "EvalConfigError";
  }
}

/**
 * Error thrown when test plan generation or validation fails.
 *
 * @example
 * ```typescript
 * throw new PlannerError("LLM returned invalid JSON");
 * ```
 */
export class PlannerError extends BaseEvalError {
  constructor(message: string, cause?: unknown) {
    super(message, "PLANNER_ERROR", cause);
    this.name = "PlannerError";
  }
}

/**
 * Error thrown when CLI should exit with a specific exit code.
 * Used internally for CLI error handling.
 *
 * @internal
 */
export class CliExitError extends BaseEvalError {
  /** Process exit code */
  readonly exitCode: number;

  constructor(message: string, exitCode: number, cause?: unknown) {
    super(message, "CLI_EXIT", cause);
    this.name = "CliExitError";
    this.exitCode = exitCode;
  }
}
