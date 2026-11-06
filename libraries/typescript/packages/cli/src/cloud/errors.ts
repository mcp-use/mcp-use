import { CommandError } from "../core/errors.js";

/** Operational error that represents a missing or invalid CLI choice. */
export class CommandUsageError extends CommandError {
  /** Process exit code for command choices that must be supplied explicitly. */
  readonly exitCode = 2;
}
