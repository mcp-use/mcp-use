import type { CallToolResult } from "./result-types.js";
import { useCallback, useRef, useState } from "react";

import type { ToolRef } from "../tools.js";
import type { RegisteredTools } from "./register.js";
import { useViewBridgeStore } from "./view-bridge.js";

/**
 * Typed server-tool call handle returned by {@link useCallTool}.
 */
export interface CallToolHandle<Args, Result> {
  /** Invoke the server tool over the bridge. */
  callTool: (args: Args) => Promise<CallToolResult & { structuredContent: Result }>;
  /** Last successful result, if any. */
  data: (CallToolResult & { structuredContent: Result }) | undefined;
  /** Last failure (cleared on the next call). */
  error: Error | undefined;
  /** Whether a call is in flight. */
  isPending: boolean;
}

/**
 * Call a registered server tool from the view with inferred types.
 *
 * @example
 * ```tsx
 * const details = useCallTool("get-fruit-details");
 * await details.callTool({ fruit: "apple" });
 * if (details.data) {
 *   console.log(details.data.structuredContent);
 * }
 * ```
 */
export function useCallTool<Name extends keyof RegisteredTools>(
  name: Name
): CallToolHandle<RegisteredTools[Name]["input"], RegisteredTools[Name]["output"]>;

/**
 * Call a server tool using a {@link ToolRef} value (inline-JSX stretch path).
 */
// eslint-disable-next-line no-redeclare -- overload set
export function useCallTool<R extends ToolRef<string, unknown, unknown>>(
  ref: R
): CallToolHandle<
  R extends ToolRef<string, infer I, unknown> ? I : never,
  R extends ToolRef<string, unknown, infer O> ? O : never
>;

/**
 * Call a server tool with explicit argument/result types (escape hatch).
 */
// eslint-disable-next-line no-redeclare -- overload set
export function useCallTool<
  Args extends Record<string, unknown>,
  Result = unknown,
>(name: string): CallToolHandle<Args, Result>;

// eslint-disable-next-line no-redeclare -- implementation signature
export function useCallTool(nameOrRef: string | ToolRef<string, unknown, unknown>) {
  const toolName =
    typeof nameOrRef === "string" ? nameOrRef : nameOrRef.name;
  const store = useViewBridgeStore();
  const [data, setData] = useState<
    (CallToolResult & { structuredContent: unknown }) | undefined
  >(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const callIdRef = useRef(0);

  const callTool = useCallback(
    async (args: Record<string, unknown>) => {
      const callId = ++callIdRef.current;
      setIsPending(true);
      setError(undefined);

      try {
        const app = await store.connect();
        const result = await app.callServerTool({
          name: toolName,
          arguments: args,
        });
        const typed = result as CallToolResult & { structuredContent: unknown };
        if (callId === callIdRef.current) {
          setData(typed);
          setIsPending(false);
        }
        return typed;
      } catch (err) {
        const failure = err instanceof Error ? err : new Error(String(err));
        if (callId === callIdRef.current) {
          setError(failure);
          setIsPending(false);
        }
        throw failure;
      }
    },
    [store, toolName]
  );

  return { callTool, data, error, isPending };
}
