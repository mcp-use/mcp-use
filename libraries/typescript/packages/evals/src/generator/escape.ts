/**
 * Escape special characters in a string for safe use in generated code.
 * Handles backslashes, quotes, newlines, template literals, etc.
 * Only escapes double quotes since generated code uses double-quoted strings.
 *
 * @param value - String to escape
 * @returns Escaped string safe for code generation
 *
 * @example
 * ```typescript
 * escapeString('Hello "world"\n'); // 'Hello \\"world\\"\\n'
 * ```
 */
export function escapeString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 *
 * @param value - String to truncate
 * @param maxLength - Maximum length (including ellipsis)
 * @returns Truncated string
 *
 * @example
 * ```typescript
 * truncate("Hello world", 8); // "Hello..."
 * truncate("Hi", 10); // "Hi"
 * ```
 */
export function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (maxLength < 3) return value.slice(0, Math.max(0, maxLength));
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
