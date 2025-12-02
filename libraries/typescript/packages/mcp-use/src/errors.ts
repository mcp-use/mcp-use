/**
 * Custom error types for MCP operations
 */

/**
 * Error thrown when elicitation data validation fails.
 * This occurs when the data returned from an elicitation request
 * doesn't match the expected Zod schema.
 */
export class ElicitationValidationError extends Error {
  constructor(
    message: string,
    public cause?: Error
  ) {
    super(message);
    this.name = "ElicitationValidationError";
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ElicitationValidationError);
    }
  }
}

/**
 * Error thrown when an elicitation request times out.
 * This occurs when the user doesn't respond within the specified timeout period.
 */
export class ElicitationTimeoutError extends Error {
  constructor(
    message: string,
    public timeoutMs?: number
  ) {
    super(message);
    this.name = "ElicitationTimeoutError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ElicitationTimeoutError);
    }
  }
}

/**
 * Error thrown when a user explicitly declines an elicitation request.
 * This occurs when the user cancels or rejects the elicitation prompt.
 */
export class ElicitationDeclinedError extends Error {
  constructor(message: string = "User declined the elicitation request") {
    super(message);
    this.name = "ElicitationDeclinedError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ElicitationDeclinedError);
    }
  }
}
