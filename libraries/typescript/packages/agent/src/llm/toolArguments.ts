/** Parse provider arguments without silently replacing a malformed tool call. */
export function parseToolArguments(
  argumentsJson: string,
  toolName: string
): Record<string, unknown> {
  try {
    const args: unknown = JSON.parse(argumentsJson || "{}");
    if (args !== null && typeof args === "object" && !Array.isArray(args)) {
      return args as Record<string, unknown>;
    }
  } catch {
    // Do not expose raw argument values through JSON.parse's error message.
  }
  throw new TypeError(`Invalid JSON object arguments for tool "${toolName}".`);
}
