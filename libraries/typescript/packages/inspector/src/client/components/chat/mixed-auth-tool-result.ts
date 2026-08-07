const AUTHENTICATION_REQUIRED_PATTERNS = [
  /\b(?:authentication|authorization)\s+(?:is\s+)?required\b/i,
  /\brequires?\s+(?:oauth\s+)?authentication\b/i,
  /\b(?:authenticate|sign in)\s+to\s+(?:use|access|continue)\b/i,
];

function collectResultText(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectResultText(item, depth + 1));
  }
  if (typeof value !== "object") return [];

  return Object.values(value).flatMap((item) =>
    collectResultText(item, depth + 1)
  );
}

/**
 * Compatibility classifier for mixed-auth servers that return an MCP tool
 * error over HTTP 200 instead of issuing an HTTP OAuth challenge.
 *
 * This is intentionally presentation-only: protocol/OAuth handling remains in
 * the official SDK, and callers must additionally require mixed-auth metadata.
 */
export function isAuthenticationRequiredToolResult(
  result: unknown,
  isError: boolean
): boolean {
  if (!isError) return false;

  const text = collectResultText(result).join("\n");
  return AUTHENTICATION_REQUIRED_PATTERNS.some((pattern) => pattern.test(text));
}
