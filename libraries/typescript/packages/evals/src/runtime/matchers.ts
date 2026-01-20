import { expect } from "vitest";
import type {
  EvalResult,
  ToolCall,
  ToolCallError,
  ToolCallOutput,
} from "./types.js";

/**
 * Custom Vitest matchers for evaluating MCP agent behavior.
 * Automatically extends Vitest's expect assertions when imported.
 *
 * @module matchers
 *
 * @example
 * ```typescript
 * import "@mcp-use/evals";
 *
 * const result = await agent.run("Get weather");
 * expect(result).toHaveUsedTool("get_weather");
 * expect(result).toHaveOutputContaining("sunny");
 * ```
 */

/** Result type for Vitest custom matchers */
type MatcherResult = { pass: boolean; message: () => string };

/**
 * Type guard to check if a value is a plain object record.
 *
 * @param value - Value to check
 * @returns True if value is a non-null object (not an array)
 * @internal
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively checks if actual value contains all fields from expected value.
 * Supports nested objects and arrays.
 *
 * @param actual - The actual value to check
 * @param expected - The expected pattern to match against
 * @returns True if actual contains all expected fields with matching values
 * @internal
 */
function partialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === actual) return true;
  if (typeof expected !== "object" || expected === null) {
    return actual === expected;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((item, index) => partialMatch(actual[index], item));
  }

  if (!isRecord(actual) || !isRecord(expected)) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in actual)) return false;
    if (!partialMatch(actual[key], value)) return false;
  }
  return true;
}

/**
 * Format a list of tool calls into a human-readable string.
 *
 * @param toolCalls - Array of tool calls to describe
 * @returns Comma-separated list of tool names, or "none" if empty
 * @internal
 */
function describeToolCalls(toolCalls: ToolCall[]): string {
  if (!toolCalls.length) return "none";
  return toolCalls.map((call) => call.name).join(", ");
}

/**
 * Check if tool call output matches the expected pattern.
 * For string expectations, performs case-insensitive substring matching.
 * For object expectations, performs partial object matching.
 *
 * @param output - The tool call output to check
 * @param expected - Expected output pattern (string or object)
 * @returns True if output matches the expected pattern
 * @internal
 */
function matchOutput(
  output: ToolCallOutput | undefined,
  expected: Record<string, unknown> | string
): boolean {
  if (!output) return false;
  if (typeof expected === "string") {
    if (output.kind === "text") {
      return output.value.toLowerCase().includes(expected.toLowerCase());
    }
    if (typeof output.value === "string") {
      return output.value.toLowerCase().includes(expected.toLowerCase());
    }
    return JSON.stringify(output.value)
      .toLowerCase()
      .includes(expected.toLowerCase());
  }
  if (output.kind !== "json") return false;
  return partialMatch(output.value, expected);
}

/**
 * Check if tool call error matches the expected pattern.
 * For string expectations, performs case-insensitive substring matching.
 * For object expectations, performs partial object matching.
 *
 * @param error - The tool call error to check
 * @param expected - Expected error pattern (string or object)
 * @returns True if error matches the expected pattern
 * @internal
 */
function matchError(
  error: ToolCallError | undefined,
  expected: Record<string, unknown> | string
): boolean {
  if (!error) return false;
  if (typeof expected === "string") {
    if (error.kind === "text") {
      return error.value.toLowerCase().includes(expected.toLowerCase());
    }
    if (typeof error.value === "string") {
      return error.value.toLowerCase().includes(expected.toLowerCase());
    }
    return JSON.stringify(error.value)
      .toLowerCase()
      .includes(expected.toLowerCase());
  }
  if (error.kind !== "json") return false;
  return partialMatch(error.value, expected);
}

/**
 * Custom Vitest matchers for MCP evaluation results.
 * These matchers extend Vitest's expect() with domain-specific assertions
 * for testing agent behavior, tool calls, resource access, and performance.
 */
expect.extend({
  /**
   * Assert that a specific tool was called during the eval run.
   *
   * @param received - The EvalResult to check
   * @param toolName - Name of the tool to look for
   *
   * @example
   * ```typescript
   * expect(result).toHaveUsedTool("get_weather");
   * expect(result).not.toHaveUsedTool("delete_database");
   * ```
   */
  toHaveUsedTool(received: EvalResult, toolName: string): MatcherResult {
    const used = received.toolCalls.some((tc) => tc.name === toolName);
    return {
      pass: used,
      message: () =>
        used
          ? `Expected not to have used tool "${toolName}"`
          : `Expected to have used tool "${toolName}", but it was not called. Tools used: ${describeToolCalls(received.toolCalls)}`,
    };
  },

  /**
   * Assert that exactly N tool calls were made.
   *
   * @param received - The EvalResult to check
   * @param count - Expected number of tool calls
   *
   * @example
   * ```typescript
   * expect(result).toHaveToolCallCount(2);
   * ```
   */
  toHaveToolCallCount(received: EvalResult, count: number): MatcherResult {
    const actual = received.toolCalls.length;
    return {
      pass: actual === count,
      message: () => `Expected ${count} tool calls, but got ${actual}`,
    };
  },

  /**
   * Assert that a tool was called with specific input parameters.
   * Uses partial matching - actual input can have additional fields.
   *
   * @param received - The EvalResult to check
   * @param toolName - Name of the tool to check
   * @param partialInput - Expected input parameters (partial match)
   *
   * @example
   * ```typescript
   * expect(result).toHaveToolCallWith("search", { query: "weather" });
   * ```
   */
  toHaveToolCallWith(
    received: EvalResult,
    toolName: string,
    partialInput: Record<string, unknown>
  ): MatcherResult {
    const matches = received.toolCalls
      .filter((tc) => tc.name === toolName)
      .some((tc) => partialMatch(tc.input, partialInput));

    const firstMatch = received.toolCalls.find((tc) => tc.name === toolName);

    if (!firstMatch) {
      return {
        pass: false,
        message: () => `Tool "${toolName}" was not called`,
      };
    }

    return {
      pass: matches,
      message: () =>
        matches
          ? `Expected tool "${toolName}" not to be called with ${JSON.stringify(partialInput)}`
          : `Expected tool "${toolName}" to be called with ${JSON.stringify(partialInput)}, but got ${JSON.stringify(firstMatch.input)}`,
    };
  },

  /**
   * Assert that a tool call returned a specific result.
   * For string expectations, performs case-insensitive substring matching.
   * For object expectations, uses partial matching.
   *
   * @param received - The EvalResult to check
   * @param toolName - Name of the tool to check
   * @param partialResult - Expected result pattern (string or partial object)
   *
   * @example
   * ```typescript
   * expect(result).toHaveToolCallResult("get_weather", "sunny");
   * expect(result).toHaveToolCallResult("get_user", { name: "Alice" });
   * ```
   */
  toHaveToolCallResult(
    received: EvalResult,
    toolName: string,
    partialResult: Record<string, unknown> | string
  ): MatcherResult {
    const matches = received.toolCalls
      .filter((tc) => tc.name === toolName)
      .some((tc) => matchOutput(tc.output, partialResult));

    const firstMatch = received.toolCalls.find((tc) => tc.name === toolName);

    if (!firstMatch) {
      return {
        pass: false,
        message: () => `Tool "${toolName}" was not called`,
      };
    }

    return {
      pass: matches,
      message: () =>
        matches
          ? `Expected tool "${toolName}" result not to match ${JSON.stringify(partialResult)}`
          : `Expected tool "${toolName}" result to match ${JSON.stringify(partialResult)}, but got ${JSON.stringify(firstMatch.output)}`,
    };
  },

  /**
   * Assert that specific tools were called in the given order.
   * Tools can be called multiple times; this checks relative ordering.
   *
   * @param received - The EvalResult to check
   * @param toolNames - Array of tool names in expected order
   *
   * @example
   * ```typescript
   * expect(result).toHaveCalledToolsInOrder(["auth", "fetch_data", "save"]);
   * ```
   */
  toHaveCalledToolsInOrder(
    received: EvalResult,
    toolNames: string[]
  ): MatcherResult {
    const actualNames = received.toolCalls.map((tc) => tc.name);
    let lastIndex = -1;
    for (const name of toolNames) {
      const index = actualNames.indexOf(name, lastIndex + 1);
      if (index === -1) {
        return {
          pass: false,
          message: () =>
            `Expected tools to be called in order ${JSON.stringify(toolNames)}, but got ${JSON.stringify(actualNames)}`,
        };
      }
      lastIndex = index;
    }
    return {
      pass: true,
      message: () =>
        `Expected tools not to be called in order ${JSON.stringify(toolNames)}`,
    };
  },

  /**
   * Assert that a specific resource was accessed during the eval run.
   * Matches against both resource name and URI (substring match).
   *
   * @param received - The EvalResult to check
   * @param resourceName - Name or URI substring of the resource to look for
   *
   * @example
   * ```typescript
   * expect(result).toHaveUsedResource("config://settings");
   * ```
   */
  toHaveUsedResource(
    received: EvalResult,
    resourceName: string
  ): MatcherResult {
    const used = received.resourceAccess.some(
      (ra) => ra.name === resourceName || ra.uri.includes(resourceName)
    );
    return {
      pass: used,
      message: () =>
        used
          ? `Expected not to have accessed resource "${resourceName}"`
          : `Expected to have accessed resource "${resourceName}"`,
    };
  },

  /**
   * Assert that the agent's output contains specific text.
   * Performs case-insensitive substring matching.
   *
   * @param received - The EvalResult to check
   * @param text - Text that should appear in the output
   *
   * @example
   * ```typescript
   * expect(result).toHaveOutputContaining("weather is sunny");
   * ```
   */
  toHaveOutputContaining(received: EvalResult, text: string): MatcherResult {
    const contains = received.output.toLowerCase().includes(text.toLowerCase());
    return {
      pass: contains,
      message: () =>
        contains
          ? `Expected output not to contain "${text}"`
          : `Expected output to contain "${text}"`,
    };
  },

  /**
   * Assert that the eval completed within a time limit.
   *
   * @param received - The EvalResult to check
   * @param ms - Maximum duration in milliseconds
   *
   * @example
   * ```typescript
   * expect(result).toHaveCompletedWithinMs(5000);
   * ```
   */
  toHaveCompletedWithinMs(received: EvalResult, ms: number): MatcherResult {
    return {
      pass: received.durationMs <= ms,
      message: () =>
        `Expected completion within ${ms}ms, but took ${received.durationMs}ms`,
    };
  },

  /**
   * Assert that the eval used fewer than N tokens.
   *
   * @param received - The EvalResult to check
   * @param count - Maximum token count (input + output)
   *
   * @example
   * ```typescript
   * expect(result).toHaveUsedLessThanTokens(10000);
   * ```
   */
  toHaveUsedLessThanTokens(received: EvalResult, count: number): MatcherResult {
    return {
      pass: received.usage.totalTokens < count,
      message: () =>
        `Expected less than ${count} tokens, but used ${received.usage.totalTokens}`,
    };
  },

  /**
   * Assert that the eval failed (has an error).
   *
   * @param received - The EvalResult to check
   *
   * @example
   * ```typescript
   * expect(result).toHaveFailed();
   * ```
   */
  toHaveFailed(received: EvalResult): MatcherResult {
    const failed = !!received.error;
    return {
      pass: failed,
      message: () =>
        failed
          ? `Expected not to have failed, but got: ${received.error?.message}`
          : "Expected to have failed, but succeeded",
    };
  },

  /**
   * Assert that the eval failed with a specific error message or payload.
   * For string expectations, performs case-insensitive substring matching on error message.
   * For object expectations, uses partial matching on error payload.
   *
   * @param received - The EvalResult to check
   * @param partialPayloadOrString - Expected error pattern
   *
   * @example
   * ```typescript
   * expect(result).toHaveFailedWith("timeout");
   * expect(result).toHaveFailedWith({ code: "AUTH_ERROR" });
   * ```
   */
  toHaveFailedWith(
    received: EvalResult,
    partialPayloadOrString: Record<string, unknown> | string
  ): MatcherResult {
    if (!received.error) {
      return {
        pass: false,
        message: () => "Expected to have failed, but succeeded",
      };
    }
    if (typeof partialPayloadOrString === "string") {
      const message = received.error.message ?? "";
      const contains = message
        .toLowerCase()
        .includes(partialPayloadOrString.toLowerCase());
      return {
        pass: contains,
        message: () =>
          `Expected error message to contain "${partialPayloadOrString}", but got "${message}"`,
      };
    }
    const matches = partialMatch(received.error, partialPayloadOrString);
    return {
      pass: matches,
      message: () =>
        `Expected error to match ${JSON.stringify(partialPayloadOrString)}, but got ${JSON.stringify(received.error)}`,
    };
  },

  /**
   * Assert that a specific tool call failed (has an error).
   *
   * @param received - The EvalResult to check
   * @param toolName - Name of the tool to check
   *
   * @example
   * ```typescript
   * expect(result).toHaveToolCallFailed("invalid_operation");
   * ```
   */
  toHaveToolCallFailed(received: EvalResult, toolName: string): MatcherResult {
    const matchingCalls = received.toolCalls.filter(
      (tc) => tc.name === toolName
    );
    const hasFailed = matchingCalls.some((tc) => !!tc.error);
    const firstMatch = matchingCalls[0];

    if (!firstMatch) {
      return {
        pass: false,
        message: () => `Tool "${toolName}" was not called`,
      };
    }

    return {
      pass: hasFailed,
      message: () =>
        hasFailed
          ? `Expected tool "${toolName}" not to have failed`
          : `Expected tool "${toolName}" to have failed, but it succeeded`,
    };
  },

  /**
   * Assert that a tool call failed with a specific error message or payload.
   * For string expectations, performs case-insensitive substring matching.
   * For object expectations, uses partial matching.
   *
   * @param received - The EvalResult to check
   * @param toolName - Name of the tool to check
   * @param partialPayloadOrString - Expected error pattern
   *
   * @example
   * ```typescript
   * expect(result).toHaveToolCallFailedWith("delete", "permission denied");
   * expect(result).toHaveToolCallFailedWith("api_call", { status: 404 });
   * ```
   */
  toHaveToolCallFailedWith(
    received: EvalResult,
    toolName: string,
    partialPayloadOrString: Record<string, unknown> | string
  ): MatcherResult {
    const matchingCalls = received.toolCalls.filter(
      (tc) => tc.name === toolName
    );
    const matches = matchingCalls.some((tc) =>
      matchError(tc.error, partialPayloadOrString)
    );
    const firstMatch = matchingCalls[0];

    if (!firstMatch) {
      return {
        pass: false,
        message: () => `Tool "${toolName}" was not called`,
      };
    }

    return {
      pass: matches,
      message: () =>
        matches
          ? `Expected tool "${toolName}" error not to match ${JSON.stringify(partialPayloadOrString)}`
          : `Expected tool "${toolName}" error to match ${JSON.stringify(partialPayloadOrString)}, but got ${JSON.stringify(firstMatch.error)}`,
    };
  },
});

/**
 * TypeScript declaration for custom Vitest matchers.
 * Extends the Assertion interface to provide type-safe access to eval-specific matchers.
 */
declare module "vitest" {
  interface Assertion<T = any> {
    /** Assert that a specific tool was called */
    toHaveUsedTool(toolName: string): T;
    /** Assert exact number of tool calls */
    toHaveToolCallCount(count: number): T;
    /** Assert tool was called with specific input parameters */
    toHaveToolCallWith(
      toolName: string,
      partialInput: Record<string, unknown>
    ): T;
    /** Assert tool call returned specific result */
    toHaveToolCallResult(
      toolName: string,
      partialResult: Record<string, unknown> | string
    ): T;
    /** Assert tools were called in specific order */
    toHaveCalledToolsInOrder(toolNames: string[]): T;
    /** Assert a resource was accessed */
    toHaveUsedResource(resourceName: string): T;
    /** Assert output contains specific text */
    toHaveOutputContaining(text: string): T;
    /** Assert completion within time limit */
    toHaveCompletedWithinMs(ms: number): T;
    /** Assert token usage below limit */
    toHaveUsedLessThanTokens(count: number): T;
    /** Assert the eval failed */
    toHaveFailed(): T;
    /** Assert the eval failed with specific error */
    toHaveFailedWith(
      partialPayloadOrString: Record<string, unknown> | string
    ): T;
    /** Assert a tool call failed */
    toHaveToolCallFailed(toolName: string): T;
    /** Assert a tool call failed with specific error */
    toHaveToolCallFailedWith(
      toolName: string,
      partialPayloadOrString: Record<string, unknown> | string
    ): T;
  }
}
