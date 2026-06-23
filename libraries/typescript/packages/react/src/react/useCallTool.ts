/**
 * React hook for calling MCP tools with TanStack Query-like state management
 */

import { useCallback, useRef, useState } from "react";
import { getMcpAppsBridge } from "./mcp-apps-bridge.js";
import { normalizeCallToolResponse } from "./widget-utils.js";
import type {
  CallToolResponse,
  UnknownObject,
  ToolRegistry,
} from "./widget-types.js";

// Discriminated union state machine (4 states)
type CallToolIdleState = {
  status: "idle";
  isIdle: true;
  isPending: false;
  isSuccess: false;
  isError: false;
  data: undefined;
  error: undefined;
};

type CallToolPendingState = {
  status: "pending";
  isIdle: false;
  isPending: true;
  isSuccess: false;
  isError: false;
  data: undefined;
  error: undefined;
};

type CallToolSuccessState<TData> = {
  status: "success";
  isIdle: false;
  isPending: false;
  isSuccess: true;
  isError: false;
  data: TData;
  error: undefined;
};

type CallToolErrorState = {
  status: "error";
  isIdle: false;
  isPending: false;
  isSuccess: false;
  isError: true;
  data: undefined;
  error: unknown;
};

export type CallToolState<TData> =
  | CallToolIdleState
  | CallToolPendingState
  | CallToolSuccessState<TData>
  | CallToolErrorState;

// Side effect callbacks (like TanStack Query mutations)
export type SideEffects<TArgs, TResponse> = {
  onSuccess?: (data: TResponse, args: TArgs) => void;
  onError?: (error: unknown, args: TArgs) => void;
  onSettled?: (
    data: TResponse | undefined,
    error: unknown | undefined,
    args: TArgs
  ) => void;
};

// Helper type to check if a type has required keys
type RequiredKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
}[keyof T];

type HasRequiredKeys<T> = RequiredKeys<T> extends never ? false : true;

// Helper to determine if args are optional
type IsArgsOptional<T> = [T] extends [null]
  ? true
  : HasRequiredKeys<T> extends false
    ? true
    : false;

// Function signature for callTool (fire-and-forget with optional callbacks)
export type CallToolFn<TArgs, TResponse> =
  IsArgsOptional<TArgs> extends true
    ? {
        (): void;
        (sideEffects: SideEffects<TArgs, TResponse>): void;
        (args: TArgs): void;
        (args: TArgs, sideEffects: SideEffects<TArgs, TResponse>): void;
      }
    : {
        (args: TArgs): void;
        (args: TArgs, sideEffects: SideEffects<TArgs, TResponse>): void;
      };

// Function signature for callToolAsync (returns Promise)
export type CallToolAsyncFn<TArgs, TResponse> =
  IsArgsOptional<TArgs> extends true
    ? {
        (): Promise<TResponse>;
        (args: TArgs): Promise<TResponse>;
      }
    : (args: TArgs) => Promise<TResponse>;

// Return type combines state and methods
export type UseCallToolReturn<TArgs, TResponse> = CallToolState<TResponse> & {
  callTool: CallToolFn<TArgs, TResponse>;
  callToolAsync: CallToolAsyncFn<TArgs, TResponse>;
};

/**
 * Helper to resolve input type from ToolRegistry
 */
type ResolveInput<TName extends keyof ToolRegistry> =
  ToolRegistry[TName] extends { input: infer I } ? I : null;

/**
 * Helper to resolve output type from ToolRegistry
 */
type ResolveOutput<TName extends keyof ToolRegistry> =
  ToolRegistry[TName] extends { output: infer O }
    ? CallToolResponse & { structuredContent: O }
    : CallToolResponse;

/**
 * Hook for calling MCP tools with TanStack Query-like state management.
 *
 * Provides a discriminated union state machine (idle/pending/success/error)
 * plus two methods for calling tools:
 * - `callTool` - fire-and-forget with optional side effect callbacks
 * - `callToolAsync` - returns a Promise for the result
 *
 * Types are automatically inferred from the tool name when using `mcp-use dev`.
 * The dev server generates type definitions in `.mcp-use/tool-registry.d.ts`.
 *
 * @param name - The name of the tool to call (auto-typed from ToolRegistry)
 * @returns State and methods for calling the tool
 *
 * @example
 * ```tsx
 * // Auto-typed from ToolRegistry (when using mcp-use dev)
 * const { callTool, data, isPending } = useCallTool("search-flights");
 * // callTool, data are fully typed based on your server's tool definition
 *
 * // Fire-and-forget with callbacks
 * callTool({ destination: "NYC" }, {
 *   onSuccess: (data) => console.log(data.structuredContent.flights),
 *   onError: (error) => console.error(error)
 * });
 *
 * // Or async/await
 * const result = await callToolAsync({ destination: "NYC" });
 *
 * // Explicit generics as escape hatch
 * const { callTool } = useCallTool<{ query: string }, { results: string[] }>("custom-tool");
 * ```
 */
// Overload 1: Type-safe with ToolRegistry
export function useCallTool<TName extends keyof ToolRegistry>(
  name: TName
): UseCallToolReturn<ResolveInput<TName>, ResolveOutput<TName>>;

// Overload 2: Fallback with explicit generics
// eslint-disable-next-line no-redeclare
export function useCallTool<
  TArgs extends UnknownObject | null = null,
  TResponse extends Partial<CallToolResponse> = CallToolResponse,
>(name: string): UseCallToolReturn<TArgs, TResponse>;

// Implementation
// eslint-disable-next-line no-redeclare
export function useCallTool(name: string): any {
  const [{ status, data, error }, setCallToolState] = useState<
    Omit<
      CallToolState<CallToolResponse>,
      "isIdle" | "isPending" | "isSuccess" | "isError"
    >
  >({ status: "idle", data: undefined, error: undefined });

  const callIdRef = useRef(0);

  const execute = async (args: any): Promise<CallToolResponse> => {
    const callId = ++callIdRef.current;
    setCallToolState({ status: "pending", data: undefined, error: undefined });

    try {
      let raw: any;

      // Detect provider and call tool
      if (typeof window !== "undefined") {
        if (window.openai?.callTool) {
          // OpenAI Apps SDK
          raw = await window.openai.callTool(
            name,
            args as Record<string, unknown>
          );
        } else if (window !== window.parent) {
          // MCP Apps bridge
          const bridge = getMcpAppsBridge();
          raw = await bridge.callTool(name, args as Record<string, unknown>);
        } else {
          throw new Error("No tool calling interface available");
        }
      } else {
        throw new Error("useCallTool can only be used in browser environment");
      }

      const normalized = normalizeCallToolResponse(raw);

      // Only update state if this is still the latest call
      if (callId === callIdRef.current) {
        setCallToolState({
          status: "success",
          data: normalized,
          error: undefined,
        });
      }

      return normalized;
    } catch (error) {
      // Only update state if this is still the latest call
      if (callId === callIdRef.current) {
        setCallToolState({ status: "error", data: undefined, error });
      }
      throw error;
    }
  };

  const callToolAsync = useCallback(
    ((args?: any) => {
      if (args === undefined) {
        return execute(null);
      }
      return execute(args);
    }) as any,
    [name]
  );

  const callTool = useCallback(
    ((firstArg?: any, sideEffects?: any) => {
      let args: any;

      // Detect if first arg is side effects object
      if (
        firstArg &&
        typeof firstArg === "object" &&
        ("onSuccess" in firstArg ||
          "onError" in firstArg ||
          "onSettled" in firstArg)
      ) {
        args = null;
        sideEffects = firstArg;
      } else {
        args = firstArg === undefined ? null : firstArg;
      }

      execute(args)
        .then((data) => {
          sideEffects?.onSuccess?.(data, args);
          sideEffects?.onSettled?.(data, undefined, args);
        })
        .catch((error) => {
          sideEffects?.onError?.(error, args);
          sideEffects?.onSettled?.(undefined, error, args);
        });
    }) as any,
    [name]
  );

  const callToolState = {
    status,
    data,
    error,
    isIdle: status === "idle",
    isPending: status === "pending",
    isSuccess: status === "success",
    isError: status === "error",
  } as CallToolState<CallToolResponse>;

  return {
    ...callToolState,
    callTool,
    callToolAsync,
  };
}
