/**
 * Shared state management hook for callTool operations
 * Provides React Query-style state management (idle/pending/success/error)
 * Used by both widget and client useCallTool implementations
 */

import { useCallback, useState } from "react";

export type CallToolState<TOutput> = {
  status: "idle" | "pending" | "success" | "error";
  data: TOutput | undefined;
  error: Error | undefined;
};

export type CallToolStateResult<TOutput> = CallToolState<TOutput> & {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isIdle: boolean;
  reset: () => void;
  setState: (
    state:
      | CallToolState<TOutput>
      | ((prev: CallToolState<TOutput>) => CallToolState<TOutput>)
  ) => void;
};

/**
 * Shared hook for managing callTool state
 * Provides loading states and data/error management
 */
export function useCallToolState<
  TOutput = any,
>(): CallToolStateResult<TOutput> {
  const [state, setState] = useState<CallToolState<TOutput>>({
    status: "idle",
    data: undefined,
    error: undefined,
  });

  // Derived state
  const isPending = state.status === "pending";
  const isSuccess = state.status === "success";
  const isError = state.status === "error";
  const isIdle = state.status === "idle";

  // Reset function
  const reset = useCallback(() => {
    setState({ status: "idle", data: undefined, error: undefined });
  }, []);

  return {
    ...state,
    isPending,
    isSuccess,
    isError,
    isIdle,
    reset,
    setState,
  };
}
