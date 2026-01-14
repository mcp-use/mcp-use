/**
 * Typed useCallTool hook for widgets (OpenAI Apps SDK)
 * Wraps window.openai.callTool with React Query-style state management
 */

import { useCallback } from "react";
import type { CallToolResponse } from "../../widget-types.js";
import { useCallToolState } from "../useCallToolState.js";

export type UseCallToolOptions<TInput, TOutput> = {
  /** Called when the tool call succeeds */
  onSuccess?: (data: TOutput, input: TInput) => void;
  /** Called when the tool call fails */
  onError?: (error: Error, input: TInput) => void;
  /** Called after the tool call completes (success or error) */
  onSettled?: (
    data: TOutput | undefined,
    error: Error | undefined,
    input: TInput
  ) => void;
};

export type UseCallToolResult<TInput, TOutput> = {
  /** Call the tool with fire-and-forget pattern (uses callbacks) */
  callTool: (args: TInput) => Promise<void>;
  /** Call the tool and return the result (async/await pattern) */
  callToolAsync: (args: TInput) => Promise<TOutput>;
  /** Whether the tool is currently being called */
  isPending: boolean;
  /** Whether the tool call succeeded */
  isSuccess: boolean;
  /** Whether the tool call failed */
  isError: boolean;
  /** Whether no tool call has been made yet */
  isIdle: boolean;
  /** The successful response data */
  data: TOutput | undefined;
  /** The error if the call failed */
  error: Error | undefined;
  /** Reset the state to idle */
  reset: () => void;
};

/**
 * Typed hook for calling tools from widgets with loading states
 * Works with window.openai API in OpenAI Apps SDK context
 *
 * @param toolName - The name of the tool to call
 * @param options - Optional callbacks for success/error/settled
 * @returns Hook result with callTool function and loading states
 *
 * @example
 * ```typescript
 * const { callTool, isPending, data } = useCallTool<
 *   { city: string },
 *   { temperature: number }
 * >('get-weather', {
 *   onSuccess: (data) => console.log('Weather:', data),
 *   onError: (error) => console.error('Failed:', error)
 * });
 *
 * // Fire-and-forget with callbacks
 * callTool({ city: 'Paris' });
 *
 * // Or async/await
 * const result = await callToolAsync({ city: 'Paris' });
 * ```
 */
export function useCallTool<TInput = any, TOutput = any>(
  toolName: string,
  options?: UseCallToolOptions<TInput, TOutput>
): UseCallToolResult<TInput, TOutput> {
  const state = useCallToolState<TOutput>();

  const callTool = useCallback(
    async (args: TInput) => {
      // Check if window.openai is available
      if (typeof window === "undefined" || !window.openai?.callTool) {
        const error = new Error("window.openai.callTool is not available");
        state.setState({ status: "error", data: undefined, error });
        options?.onError?.(error, args);
        options?.onSettled?.(undefined, error, args);
        return;
      }

      // Set pending state
      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        // Call the tool via window.openai
        const response = (await window.openai.callTool(
          toolName,
          args as Record<string, unknown>
        )) as CallToolResponse;

        // Check if the response is an error
        if (response.isError) {
          const errorText =
            response.content.find((c) => c.type === "text")?.text ||
            "Tool call failed";
          const error = new Error(errorText);
          state.setState({ status: "error", data: undefined, error });
          options?.onError?.(error, args);
          options?.onSettled?.(undefined, error, args);
          return;
        }

        // Extract structured data (assuming TOutput structure)
        const data = response as unknown as TOutput;

        // Set success state
        state.setState({ status: "success", data, error: undefined });
        options?.onSuccess?.(data, args);
        options?.onSettled?.(data, undefined, args);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.setState({ status: "error", data: undefined, error });
        options?.onError?.(error, args);
        options?.onSettled?.(undefined, error, args);
      }
    },
    [toolName, options, state]
  );

  const callToolAsync = useCallback(
    async (args: TInput): Promise<TOutput> => {
      // Check if window.openai is available
      if (typeof window === "undefined" || !window.openai?.callTool) {
        const error = new Error("window.openai.callTool is not available");
        state.setState({ status: "error", data: undefined, error });
        throw error;
      }

      // Set pending state
      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        // Call the tool via window.openai
        const response = (await window.openai.callTool(
          toolName,
          args as Record<string, unknown>
        )) as CallToolResponse;

        // Check if the response is an error
        if (response.isError) {
          const errorText =
            response.content.find((c) => c.type === "text")?.text ||
            "Tool call failed";
          const error = new Error(errorText);
          state.setState({ status: "error", data: undefined, error });
          throw error;
        }

        // Extract structured data (assuming TOutput structure)
        const data = response as unknown as TOutput;

        // Set success state
        state.setState({ status: "success", data, error: undefined });
        return data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.setState({ status: "error", data: undefined, error });
        throw error;
      }
    },
    [toolName, state]
  );

  return {
    callTool,
    callToolAsync,
    ...state,
  };
}
