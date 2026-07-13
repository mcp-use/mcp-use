import { useCallback, useRef, useState } from "react";

import type { ToolRef } from "../../tools.js";
import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { RegisteredTools } from "../types/register.js";
import {
  InvalidToolResultError,
  type CallToolData,
  type CallToolResult,
} from "../types/result-types.js";

export type { CallToolData } from "../types/result-types.js";
export { InvalidToolResultError } from "../types/result-types.js";

/**
 * Typed server-tool call handle returned by {@link useCallTool}.
 *
 * @typeParam Args - Tool argument object type.
 * @typeParam Result - Expected `structuredContent` type for a non-error result.
 */
export interface CallToolHandle<Args, Result> {
  /**
   * Invoke the server tool over the bridge.
   *
   * Valid tool errors (`isError: true`) resolve into {@link CallToolData}.
   * Transport, RPC, capability, and malformed non-error results reject.
   *
   * @param args - Tool arguments matching the registered input schema.
   * @returns Discriminated success vs tool-error result.
   * @throws {@link InvalidToolResultError} when a non-error result omits
   * `structuredContent`. Transport, RPC, and missing-`serverTools` failures
   * also reject with an `Error`.
   */
  callTool: (args: Args) => Promise<CallToolData<Result>>;
  /**
   * Last successful or tool-error result. Preserved while a later request is
   * pending or fails (transport / malformed).
   */
  data: CallToolData<Result> | undefined;
  /**
   * Last transport / RPC / capability / malformed-result failure. Cleared on
   * the next call.
   */
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
 * const result = await details.callTool({ fruit: "apple" });
 * if (result.isError) {
 *   showToolError(result.content);
 *   return;
 * }
 * showDetails(result.structuredContent);
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
  const [data, setData] = useState<CallToolData<unknown> | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const callIdRef = useRef(0);

  const callTool = useCallback(
    async (args: Record<string, unknown>): Promise<CallToolData<unknown>> => {
      const callId = ++callIdRef.current;
      setIsPending(true);
      setError(undefined);

      try {
        const result = await runtime.callServerTool({
          name: toolName,
          arguments: args,
        });

        if (result.isError === true) {
          const typed = result as CallToolData<unknown> & { isError: true };
          if (callId === callIdRef.current) {
            setData(typed);
            setIsPending(false);
          }
          return typed;
        }

        if (result.structuredContent === undefined) {
          throw new InvalidToolResultError(
            "Tool returned a non-error result without structuredContent",
            result
          );
        }

        const typed = result as CallToolResult & {
          isError?: false;
          structuredContent: unknown;
        };
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
