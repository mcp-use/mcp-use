/** Parse provider arguments without silently replacing a malformed tool call. */
export function parseToolArguments(
  argumentsJson: unknown,
  toolName: string
): Record<string, unknown> {
  if (typeof argumentsJson === "string") {
    try {
      const args: unknown = JSON.parse(
        argumentsJson === "" ? "{}" : argumentsJson
      );
      if (args !== null && typeof args === "object" && !Array.isArray(args)) {
        return args as Record<string, unknown>;
      }
    } catch {
      // Do not expose raw argument values through JSON.parse's error message.
    }
  }
  throw new TypeError(`Invalid JSON object arguments for tool "${toolName}".`);
}
