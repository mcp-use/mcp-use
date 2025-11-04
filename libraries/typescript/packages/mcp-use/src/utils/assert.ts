/**
 * Asserts that a condition is true, throwing an error if not.
 * Useful for type narrowing.
 * @param condition The condition to check.
 * @param message The error message to throw if the condition is false.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
