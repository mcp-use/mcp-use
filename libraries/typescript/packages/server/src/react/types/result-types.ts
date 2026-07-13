import type { CallToolResult } from "@modelcontextprotocol/server";

export type { CallToolResult };

/**
 * Concatenated text content of a tool result, or `undefined` when it has none.
 *
 * Joins the `text` of every `content` block with `type === "text"` using
 * `"\n"`, then trims. Returns `undefined` when there are no text blocks or
 * the joined result is empty/whitespace — callers choose their own fallback.
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
 * Human-readable message for a `kind: "tool"` {@link ToolContextError}.
 *
 * Uses {@link toolResultText}; falls back to a generic non-empty string when
 * the result has no usable text content.
 *
 * @param result - Error tool result (`isError: true`).
 * @returns Always a non-empty string.
 *
 * @internal
 */
export function toolContextErrorMessage(
  result: Pick<CallToolResult, "content">
): string {
  return toolResultText(result) ?? "Tool returned an error.";
}

/**
 * Error payload on the `"error"` branch of {@link ToolContextHandle}.
 *
 * Distinguishes a valid MCP tool error (`isError: true`, with or without
 * `structuredContent`) from a non-error result that violates the schema-backed
 * contract by omitting `structuredContent`. Both branches expose `message` so
 * consumers can render `error.message` without narrowing on `kind` first; keep
 * `result` for full access to the underlying {@link CallToolResult}.
 */
export type ToolContextError =
  | {
      /** Valid MCP tool error — not typed output. */
      kind: "tool";
      /**
       * Human-readable message derived from the error result's text content
       * blocks (joined with `"\n"`), or `"Tool returned an error."` when there
       * are none.
       */
      message: string;
      /** The error result as delivered by the host (`isError: true`). */
      result: CallToolResult & { isError: true };
    }
  | {
      /** Non-error result missing required `structuredContent`. */
      kind: "invalid-result";
      /** Human-readable description of the contract violation. */
      message: string;
      /** The malformed non-error result. */
      result: CallToolResult;
    };

/**
 * Discriminated result of {@link useCallTool}: a successful typed payload or a
 * valid MCP tool error (`isError: true`).
 *
 * @typeParam Result - Expected `structuredContent` type for a non-error result.
 *
 * @remarks
 * Narrow with `if (result.isError)` — the error branch exposes
 * `structuredContent` as `unknown | undefined`; the success branch guarantees
 * typed `structuredContent`.
 */
export type CallToolData<Result> =
  | (CallToolResult & {
      isError?: false;
      structuredContent: Result;
    })
  | (CallToolResult & {
      isError: true;
      structuredContent?: unknown;
    });

/**
 * Thrown when a non-error tool result is missing `structuredContent`.
 *
 * Valid MCP tool errors (`isError: true`) are not invalid — they resolve into
 * {@link CallToolData} instead. This error covers protocol/framework contract
 * violations on the success path only.
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
