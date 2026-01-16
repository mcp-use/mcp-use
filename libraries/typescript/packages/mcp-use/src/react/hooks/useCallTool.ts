/**
 * Unified typed useCallTool hook that adapts to context automatically
 * - Widget context: uses window.openai.callTool (pass tool name directly)
 * - MCP client context: uses server.callTool (pass server object)
 *
 * Supports type-safe tool names via ToolRegistry pattern for autocomplete
 */

import { useCallback } from "react";
import type { CallToolResponse } from "../widget-types.js";
import { useCallToolState } from "./useCallToolState.js";

// ============================================================
// Tool Registry Types - For Type-Safe Tool Names
// ============================================================

/**
 * Define a tool with input and output types
 */
export type ToolDefinition<TInput = any, TOutput = any> = {
  input: TInput;
  output: TOutput;
};

/**
 * A registry of tool definitions for type-safe autocomplete
 *
 * @example
 * ```typescript
 * type MyTools = {
 *   'get-weather': { input: { city: string }; output: { temp: number } };
 *   'send-email': { input: { to: string; body: string }; output: { id: string } };
 * };
 * ```
 */
export type ToolRegistry = {
  [toolName: string]: ToolDefinition;
};

/**
 * Extract input type from a tool in the registry
 */
export type ToolInput<
  TRegistry extends ToolRegistry,
  TName extends keyof TRegistry,
> = TRegistry[TName]["input"];

/**
 * Extract output type from a tool in the registry
 */
export type ToolOutput<
  TRegistry extends ToolRegistry,
  TName extends keyof TRegistry,
> = TRegistry[TName]["output"];

// ============================================================
// Server Types
// ============================================================

/**
 * Interface for objects that can call MCP tools
 * Compatible with useMcp() result and useMcpServer() result
 */
export interface McpServerLike {
  /** Call a tool by name */
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    options?: {
      timeout?: number;
      maxTotalTimeout?: number;
      resetTimeoutOnProgress?: boolean;
    }
  ) => Promise<any>;
  /** Current connection state */
  state?: string;
}

/**
 * Type-safe MCP server with tool registry
 * Provides autocomplete for tool names
 */
export interface TypedMcpServer<
  TTools extends ToolRegistry,
> extends McpServerLike {
  /** Type-branded for tool registry */
  readonly __toolRegistry?: TTools;
}

// ============================================================
// Hook Types
// ============================================================

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
  /** Timeout in milliseconds for this tool call (MCP client only, default: 60000 / 60 seconds) */
  timeout?: number;
  /** Maximum total timeout in milliseconds, even with progress resets (MCP client only) */
  maxTotalTimeout?: number;
  /** Reset the timeout when progress notifications are received (MCP client only, default: false) */
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

// ============================================================
// Overloaded Signatures
// ============================================================

/* eslint-disable no-redeclare */

/**
 * Widget context - pass tool name directly (uses window.openai.callTool)
 *
 * @example
 * ```typescript
 * const hook = useCallTool<{ city: string }, { temp: number }>('get-weather');
 * hook.callTool({ city: 'Paris' });
 * ```
 */
export function useCallTool<TInput = any, TOutput = any>(
  toolName: string,
  options?: UseCallToolOptions<TInput, TOutput>
): UseCallToolResult<TInput, TOutput>;

/**
 * MCP server context with type-safe tool registry
 * Provides autocomplete for tool names
 *
 * @example
 * ```typescript
 * type MyTools = {
 *   'get-weather': { input: { city: string }; output: { temp: number } };
 * };
 * const server = useMcpServer('weather') as TypedMcpServer<MyTools>;
 * const hook = useCallTool(server, 'get-weather'); // 'get-weather' autocompletes!
 * ```
 */
export function useCallTool<
  TTools extends ToolRegistry,
  TName extends keyof TTools & string,
>(
  server: TypedMcpServer<TTools> | null | undefined,
  toolName: TName,
  options?: UseCallToolOptions<TTools[TName]["input"], TTools[TName]["output"]>
): UseCallToolResult<TTools[TName]["input"], TTools[TName]["output"]>;

/**
 * MCP server context - pass server object and tool name
 *
 * @example
 * ```typescript
 * const mcp = useMcp({ url: '...' });
 * const hook = useCallTool<Input, Output>(mcp, 'get-weather');
 * ```
 */
export function useCallTool<TInput = any, TOutput = any>(
  server: McpServerLike | null | undefined,
  toolName: string,
  options?: UseCallToolOptions<TInput, TOutput>
): UseCallToolResult<TInput, TOutput>;

// ============================================================
// Implementation
// ============================================================

export function useCallTool<TInput = any, TOutput = any>(
  serverOrToolName: McpServerLike | string | null | undefined,
  toolNameOrOptions?: string | UseCallToolOptions<TInput, TOutput>,
  optionsParam?: UseCallToolOptions<TInput, TOutput>
): UseCallToolResult<TInput, TOutput> {
  // Parse arguments to determine context
  const isWidgetMode = typeof serverOrToolName === "string";
  const server = isWidgetMode
    ? null
    : (serverOrToolName as McpServerLike | null | undefined);
  const toolName = isWidgetMode
    ? (serverOrToolName as string)
    : (toolNameOrOptions as string);
  const options = isWidgetMode
    ? (toolNameOrOptions as UseCallToolOptions<TInput, TOutput> | undefined)
    : optionsParam;

  const state = useCallToolState<TOutput>();

  // Widget implementation (uses window.openai.callTool)
  const callToolWidget = useCallback(
    async (args: TInput) => {
      if (typeof window === "undefined" || !window.openai?.callTool) {
        const error = new Error("window.openai.callTool is not available");
        state.setState({ status: "error", data: undefined, error });
        options?.onError?.(error, args);
        options?.onSettled?.(undefined, error, args);
        return;
      }

      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        const response = (await window.openai.callTool(
          toolName,
          args as Record<string, unknown>
        )) as CallToolResponse;

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

        const data = response as unknown as TOutput;
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

  // MCP server implementation (uses server.callTool)
  const callToolServer = useCallback(
    async (args: TInput) => {
      if (!server?.callTool) {
        const error = new Error("MCP server is not connected");
        state.setState({ status: "error", data: undefined, error });
        options?.onError?.(error, args);
        options?.onSettled?.(undefined, error, args);
        return;
      }

      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        const response = await server.callTool(
          toolName,
          args as Record<string, unknown>,
          {
            timeout: options?.timeout,
            maxTotalTimeout: options?.maxTotalTimeout,
            resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
          }
        );

        const data = response as unknown as TOutput;
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
    [server, toolName, options, state]
  );

  // Async versions
  const callToolAsyncWidget = useCallback(
    async (args: TInput): Promise<TOutput> => {
      if (typeof window === "undefined" || !window.openai?.callTool) {
        const error = new Error("window.openai.callTool is not available");
        state.setState({ status: "error", data: undefined, error });
        throw error;
      }

      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        const response = (await window.openai.callTool(
          toolName,
          args as Record<string, unknown>
        )) as CallToolResponse;

        if (response.isError) {
          const errorText =
            response.content.find((c) => c.type === "text")?.text ||
            "Tool call failed";
          const error = new Error(errorText);
          state.setState({ status: "error", data: undefined, error });
          throw error;
        }

        const data = response as unknown as TOutput;
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

  const callToolAsyncServer = useCallback(
    async (args: TInput): Promise<TOutput> => {
      if (!server?.callTool) {
        const error = new Error("MCP server is not connected");
        state.setState({ status: "error", data: undefined, error });
        throw error;
      }

      state.setState({ status: "pending", data: undefined, error: undefined });

      try {
        const response = await server.callTool(
          toolName,
          args as Record<string, unknown>,
          {
            timeout: options?.timeout,
            maxTotalTimeout: options?.maxTotalTimeout,
            resetTimeoutOnProgress: options?.resetTimeoutOnProgress,
          }
        );

        const data = response as unknown as TOutput;
        state.setState({ status: "success", data, error: undefined });
        return data;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        state.setState({ status: "error", data: undefined, error });
        throw error;
      }
    },
    [server, toolName, options, state]
  );

  // Choose the appropriate implementation based on context
  const callTool = isWidgetMode ? callToolWidget : callToolServer;
  const callToolAsync = isWidgetMode
    ? callToolAsyncWidget
    : callToolAsyncServer;

  return {
    callTool,
    callToolAsync,
    ...state,
  };
}

/* eslint-enable no-redeclare */
