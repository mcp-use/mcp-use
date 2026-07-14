import type { CallToolResult } from "@modelcontextprotocol/server";

export type { CallToolResult };

/**
 * Concatenated text content of a tool result, or `undefined` when it has none.
 *
 * Joins the `text` of every `content` block with `type === "text"` using
 * `"\n"`, then trims. Returns `undefined` when there are no text blocks or
 * the joined result is empty/whitespace — callers choose their own fallback.
 *
 * Useful when reading human-readable text from a {@link CallToolResult}
 * (success or error) without inspecting the full `content` array.
 *
 * @param result - Tool result (or any object with a `content` array).
 * @returns Joined trimmed text, or `undefined` when there is none.
 *
 * @example
 * ```ts
 * const text = toolResultText(result) ?? "No message.";
 * ```
 */
export function toolResultText(
  result: Pick<CallToolResult, "content">
): string | undefined {
  const blocks = result.content;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return undefined;
  }

  const parts: string[] = [];
  for (const block of blocks) {
    if (
      block !== null &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : undefined;
}

/**
 * The bound or called tool ran and answered with `isError: true` — a domain
 * error, not a transport or protocol failure.
 *
 * `message` is derived from the error result's text content blocks (via
 * {@link toolResultText}), or `"Tool returned an error."` when there are none.
 */
export class ToolError extends Error {
  /** The error result as delivered (`isError: true`). */
  readonly result: CallToolResult & { isError: true };

  /**
   * @param result - The tool result with `isError: true`.
   */
  constructor(result: CallToolResult & { isError: true }) {
    super(toolResultText(result) ?? "Tool returned an error.");
    this.name = "ToolError";
    this.result = result;
  }
}

/**
 * Thrown when a view-bound tool's non-error result is missing
 * `structuredContent`.
 *
 * Only the view-bound result channel ({@link useToolContext}) produces this:
 * registration requires an `outputSchema` on every view-bound tool, so a
 * non-error result without `structuredContent` there is a framework/host
 * contract violation. Valid MCP tool errors (`isError: true`) are
 * {@link ToolError}, not this class.
 */
export class InvalidToolResultError extends Error {
  /**
   * The malformed non-error {@link CallToolResult} that lacked
   * `structuredContent`.
   */
  readonly result: CallToolResult;

  /**
   * @param message - Human-readable description of the contract violation.
   * @param result - The non-error result missing `structuredContent`.
   */
  constructor(message: string, result: CallToolResult) {
    super(message);
    this.name = "InvalidToolResultError";
    this.result = result;
  }
}

/**
 * Error that can appear in the `"error"` branch of {@link ToolContextHandle}.
 *
 * Narrow with `instanceof` {@link ToolError} vs
 * {@link InvalidToolResultError} when the class matters; both expose
 * `message` for rendering.
 */
export type ToolContextError = ToolError | InvalidToolResultError;

/**
 * Successful non-error tool result returned by {@link useCallTool}.
 *
 * `structuredContent` is guaranteed and typed exactly when the tool declares
 * an `outputSchema` (`Result` is not `never`) — the server rejects non-error
 * results from schema-backed tools that lack it, so a resolved result always
 * carries it. Tools without an `outputSchema` (`Result = never`) legitimately
 * return content-only results, so no `structuredContent` guarantee is added
 * beyond the base {@link CallToolResult} (optional, `unknown`).
 *
 * Tool errors and transport failures reject instead — they never appear here.
 *
 * @typeParam Result - Inferred `structuredContent` type from the tool's
 * `outputSchema`; `never` when the tool declares none.
 */
export type CallToolSuccess<Result> = CallToolResult & {
  isError?: false;
} & ([Result] extends [never] ? unknown : { structuredContent: Result });
