import type { CallToolResult } from "@modelcontextprotocol/server";

export type { CallToolResult };

/**
 * Error payload on the `"error"` branch of {@link ToolContextHandle}.
 *
 * Distinguishes a valid MCP tool error (`isError: true`, with or without
 * `structuredContent`) from a non-error result that violates the schema-backed
 * contract by omitting `structuredContent`.
 */
export type ToolContextError =
  | {
      /** Valid MCP tool error — not typed output. */
      kind: "tool";
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
