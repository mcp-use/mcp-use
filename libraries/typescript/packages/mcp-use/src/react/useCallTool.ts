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
import type { ToolRef } from "../server/types/tool-ref.js";

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
 * Prefer passing the `ToolRef` returned by `server.tool()` when the server and
 * view share a TypeScript graph. That path is zero-codegen: the ref carries the
 * input/output types as phantom types while runtime still sends the tool name.
 *
 * String tool names remain supported. They are typed from an explicit generated
 * registry when projects run `mcp-use typegen` / `mcp-use check`, or by explicit
 * generics when the client is intentionally decoupled from the server source.
 *
 * @param name - The name of the tool to call (auto-typed from ToolRegistry)
 * @returns State and methods for calling the tool
 *
 * @example
 * ```tsx
 * // Zero-codegen path: use the ToolRef returned by server.tool()
 * const { callTool, data, isPending } = useCallTool(searchFlights);
 * // callTool and data are typed from the server's tool definition
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
 * // Explicit generics as an escape hatch for decoupled clients
 * const { callTool } = useCallTool<{ query: string }, { results: string[] }>("custom-tool");
 * ```
 */
// Overload 1: Type-safe with ToolRegistry
export function useCallTool<TName extends keyof ToolRegistry>(
  name: TName
): UseCallToolReturn<ResolveInput<TName>, ResolveOutput<TName>>;

// Overload 2: string-name calls with explicit generics or generated registry types.

export function useCallTool<
  TArgs extends UnknownObject | null = null,
  TResponse extends Partial<CallToolResponse> = CallToolResponse,
>(name: string): UseCallToolReturn<TArgs, TResponse>;

// Overload 3: ToolRef-based (zero codegen, types from server.tool() return)

export function useCallTool<
  R extends ToolRef<string, unknown, Record<string, unknown>>,
>(
  ref: R
): UseCallToolReturn<
  R["_types"]["input"],
  R["_types"]["output"] extends Record<string, unknown>
    ? CallToolResponse & { structuredContent: R["_types"]["output"] }
    : CallToolResponse
>;

// Implementation

export function useCallTool(
  nameOrRef: string | ToolRef<string, unknown, Record<string, unknown>>
): unknown {
  const name = typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
  const [{ status, data, error }, setCallToolState] = useState<
    Omit<
      CallToolState<CallToolResponse>,
      "isIdle" | "isPending" | "isSuccess" | "isError"
    >
  >({ status: "idle", data: undefined, error: undefined });

  const callIdRef = useRef(0);

  const execute = async (
    args: UnknownObject | null
  ): Promise<CallToolResponse> => {
    const callId = ++callIdRef.current;
    setCallToolState({ status: "pending", data: undefined, error: undefined });

    try {
      let raw: unknown;

      if (typeof window !== "undefined") {
        const bridge = getMcpAppsBridge();
        raw = await bridge.callTool(name, args as Record<string, unknown>);
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

  const isSideEffects = (
    value: unknown
  ): value is SideEffects<UnknownObject | null, CallToolResponse> =>
    !!value &&
    typeof value === "object" &&
    ("onSuccess" in value || "onError" in value || "onSettled" in value);

  const callToolAsync = useCallback(
    ((args?: UnknownObject | null) => execute(args ?? null)) as CallToolAsyncFn<
      UnknownObject | null,
      CallToolResponse
    >,
    [name]
  );

  const callTool = useCallback(
    ((
      firstArg?:
        | UnknownObject
        | null
        | SideEffects<UnknownObject | null, CallToolResponse>,
      sideEffects?: SideEffects<UnknownObject | null, CallToolResponse>
    ) => {
      let args: UnknownObject | null;
      let resolvedSideEffects = sideEffects;

      // Detect if first arg is side effects object
      if (isSideEffects(firstArg)) {
        args = null;
        resolvedSideEffects = firstArg;
      } else {
        args = firstArg ?? null;
      }

      execute(args)
        .then((data) => {
          resolvedSideEffects?.onSuccess?.(data, args);
          resolvedSideEffects?.onSettled?.(data, undefined, args);
        })
        .catch((error) => {
          resolvedSideEffects?.onError?.(error, args);
          resolvedSideEffects?.onSettled?.(undefined, error, args);
        });
    }) as CallToolFn<UnknownObject | null, CallToolResponse>,
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
