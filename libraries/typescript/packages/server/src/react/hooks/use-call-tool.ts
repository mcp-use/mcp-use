import { useCallback, useRef, useState } from "react";

import type { ToolRef } from "../../tools.js";
import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { RegisteredTools } from "../types/register.js";
import {
  ToolError,
  type CallToolResult,
  type CallToolSuccess,
} from "../types/result-types.js";

export type { CallToolSuccess } from "../types/result-types.js";
export { ToolError } from "../types/result-types.js";

/**
 * Typed server-tool call handle returned by {@link useCallTool}.
 *
 * @typeParam Args - Tool argument object type.
 * @typeParam Result - Expected `structuredContent` type for a successful result.
 */
export interface CallToolHandle<Args, Result> {
  /**
   * Invoke the server tool over the bridge.
   *
   * Every non-error result resolves. `structuredContent` is guaranteed and
   * typed exactly when the tool declares an `outputSchema` — the server
   * rejects non-error results from schema-backed tools that lack it, so a
   * resolved result from a schema'd tool always carries it. Tools without an
   * `outputSchema` legitimately return content-only results.
   *
   * @param args - Tool arguments matching the registered input schema.
   * @returns Successful result ({@link CallToolSuccess}).
   * @throws {@link ToolError} when the tool answers with `isError: true`.
   * Transport, RPC, and missing-`serverTools` failures also reject with an
   * `Error`.
   */
  callTool: (args: Args) => Promise<CallToolSuccess<Result>>;
  /**
   * Last successful result only. Preserved while a later request is pending
   * or fails (tool error / transport).
   */
  data: CallToolSuccess<Result> | undefined;
  /**
   * Last failure ({@link ToolError} or transport/RPC/capability `Error`).
   * Cleared on the next call.
   */
  error: Error | undefined;
  /** Whether a call is in flight. */
  isPending: boolean;
}

/**
 * Call a registered server tool from the view with inferred types.
 *
 * Successful results populate `data` and clear `error`. Tool errors and
 * transport failures reject and populate `error` while preserving previous
 * `data`. Prefer reading `data` / `error` from the handle for React UI; use
 * try/catch for imperative flows.
 *
 * @example
 * ```tsx
 * const details = useCallTool("get-fruit-details");
 *
 * // State-driven (typical in React):
 * // {details.error && <ErrorBanner message={details.error.message} />}
 * // {details.data && <DetailsCard data={details.data.structuredContent} />}
 *
 * // Imperative:
 * try {
 *   const result = await details.callTool({ fruit: "apple" });
 *   showDetails(result.structuredContent);
 * } catch (err) {
 *   if (err instanceof ToolError) {
 *     showToolError(err.message);
 *   }
 * }
 * ```
 */
export function useCallTool<Name extends keyof RegisteredTools>(
  name: Name
): CallToolHandle<RegisteredTools[Name]["input"], RegisteredTools[Name]["output"]>;

/**
 * Call a server tool using a {@link ToolRef} value (inline-JSX stretch path).
 *
 * @typeParam R - Tool ref carrying name, input, and output types.
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
 *
 * @typeParam Args - Explicit argument object type.
 * @typeParam Result - Explicit `structuredContent` type.
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
  const runtime = useViewRuntime();
  const [data, setData] = useState<CallToolSuccess<unknown> | undefined>(
    undefined
  );
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const callIdRef = useRef(0);

  const callTool = useCallback(
    async (args: Record<string, unknown>): Promise<CallToolSuccess<unknown>> => {
      const callId = ++callIdRef.current;
      setIsPending(true);
      setError(undefined);

      try {
        const result = await runtime.callServerTool({
          name: toolName,
          arguments: args,
        });

        if (result.isError === true) {
          throw new ToolError(result as CallToolResult & { isError: true });
        }

        const typed = result as CallToolSuccess<unknown>;
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
    [runtime, toolName]
  );

  return { callTool, data, error, isPending };
}
