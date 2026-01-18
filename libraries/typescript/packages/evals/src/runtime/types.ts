/**
 * Output from a successful tool call execution.
 * Can be either JSON data or text content.
 */
export type ToolCallOutput =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string };

/**
 * Error from a failed tool call execution.
 * Can be either JSON data or text content.
 */
export type ToolCallError =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string };

/**
 * Record of a single tool call execution during an eval run.
 * Includes timing information and both input parameters and output/error results.
 */
export interface ToolCall {
  /** Name of the tool that was called */
  name: string;
  /** Input parameters passed to the tool */
  input: Record<string, unknown>;
  /** Output from successful tool execution */
  output?: ToolCallOutput;
  /** Error from failed tool execution */
  error?: ToolCallError;
  /** Duration of the tool call in milliseconds */
  durationMs: number;
  /** Unix timestamp (ms) when the tool call started */
  startedAt: number;
  /** Tool call ID for matching with tool messages */
  tool_call_id?: string;
}

/**
 * Record of a resource access during an eval run.
 * Tracks when and which resources were read by the agent.
 */
export interface ResourceAccess {
  /** Name of the resource that was accessed */
  name: string;
  /** URI of the resource that was accessed */
  uri: string;
  /** Optional data returned from the resource */
  data?: unknown;
  /** Unix timestamp (ms) when the resource was accessed */
  accessedAt: number;
}

/**
 * Token usage metrics for LLM calls during an eval run.
 */
export interface TokenUsage {
  /** Number of input tokens consumed */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
}

/**
 * Result from running an evaluation test.
 * Contains the agent's output, execution trace, and performance metrics.
 *
 * @example
 * ```typescript
 * const result = await agent.run("What's the weather?");
 * expect(result).toHaveUsedTool("get_weather");
 * expect(result.output).toContain("sunny");
 * ```
 */
export interface EvalResult {
  /** The prompt that was sent to the agent */
  input: string;
  /** The final response from the agent */
  output: string;
  /** All tool calls made during execution */
  toolCalls: ToolCall[];
  /** All resources accessed during execution */
  resourceAccess: ResourceAccess[];
  /** Token usage metrics */
  usage: TokenUsage;
  /** Total duration of the eval run in milliseconds */
  durationMs: number;
  /** Error information if the eval failed */
  error?: { code: string; message: string; [key: string]: unknown };
  /**
   * Send a follow-up prompt in the same conversation context.
   *
   * @param prompt - The follow-up message to send
   * @returns A new EvalResult for the follow-up interaction
   */
  followUp(prompt: string): Promise<EvalResult>;
}

/**
 * Agent instance for running evaluation tests.
 * Manages MCP server connections and provides methods for test execution.
 *
 * @example
 * ```typescript
 * const agent = await createEvalAgent({
 *   runAgent: "sonnet",
 *   servers: ["weather"]
 * });
 *
 * const result = await agent.run("What's the weather in SF?");
 * await agent.cleanup();
 * ```
 */
export interface EvalAgent {
  /**
   * Execute a prompt and return the evaluation result.
   *
   * @param prompt - The prompt to send to the agent
   * @param options - Optional configuration
   * @param options.timeout - Maximum execution time in milliseconds
   * @returns The evaluation result with execution trace
   */
  run(prompt: string, options?: { timeout?: number }): Promise<EvalResult>;
  /**
   * Clean up resources and close MCP server connections.
   * Should be called after all tests complete.
   */
  cleanup(): Promise<void>;
}
