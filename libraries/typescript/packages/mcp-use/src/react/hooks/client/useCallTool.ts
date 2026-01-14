/**
 * Typed useCallTool hook for MCP clients
 * Wraps BrowserMCPClient.callTool with React Query-style state management
 */

import { useCallback } from "react";
import type { BrowserMCPClient } from "../../../client/browser.js";
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
  /** Timeout in milliseconds for this tool call (default: 60000 / 60 seconds) */
  timeout?: number;
  /** Maximum total timeout in milliseconds, even with progress resets */
  maxTotalTimeout?: number;
  /** Reset the timeout when progress notifications are received (default: false) */
  resetTimeoutOnProgress?: boolean;
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
 * Typed hook for calling tools from MCP clients with loading states
 * Works with BrowserMCPClient for browser-based MCP connections
 *
 * @param client - The BrowserMCPClient instance (from useMcp)
 * @param toolName - The name of the tool to call
 * @param options - Optional callbacks and timeout configuration
 * @returns Hook result with callTool function and loading states
 *
 * @example
 * ```typescript
 * const mcp = useMcp({ url: 'http://localhost:3000/mcp' });
 *
 * const { callTool, isPending, data } = useCallTool<
 *   { city: string },
 *   { temperature: number }
 * >(mcp.client, 'get-weather', {
 *   timeout: 60000,
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
  client: BrowserMCPClient | null,
  toolName: string,
  options?: UseCallToolOptions<TInput, TOutput>
): UseCallToolResult<TInput, TOutput> {
  const state = useCallToolState<TOutput>();

  const callTool = useCallback(
    async (args: TInput) => {
      // Check if client is available
      if (!client) {
        const error = new Error("MCP client is not available");
        state.setState({ status: "error", data: undefined, error });
        options?.onError?.(error, args);
        options?.onSettled?.(undefined, error, args);
        return;
      }

      // Set pending state
      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        // Call the tool via MCP client
        const response = await client.callTool(
          toolName,
          args as Record<string, unknown>,
          {
            timeout: options?.timeout,
            maxTotalTimeout: options?.maxTotalTimeout,
            resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
          }
        );

        // Extract data (assuming TOutput structure)
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
    [client, toolName, options, state]
  );

  const callToolAsync = useCallback(
    async (args: TInput): Promise<TOutput> => {
      // Check if client is available
      if (!client) {
        const error = new Error("MCP client is not available");
        state.setState({ status: "error", data: undefined, error });
        throw error;
      }

      // Set pending state
      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        // Call the tool via MCP client
        const response = await client.callTool(
          toolName,
          args as Record<string, unknown>,
          {
            timeout: options?.timeout,
            maxTotalTimeout: options?.maxTotalTimeout,
            resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
          }
        );

        // Extract data (assuming TOutput structure)
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
    [client, toolName, options, state]
  );

  return {
    callTool,
    callToolAsync,
    ...state,
  };
}
