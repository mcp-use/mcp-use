import type { ContentBlock } from "@modelcontextprotocol/server";

import { useViewBridgeSnapshot } from "../bridge/view-bridge.js";
import type { DeepPartial, RegisteredTools } from "../types/register.js";

type ToolOutput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["output"]
  : unknown;

type ToolInput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["input"]
  : unknown;

/**
 * Discriminated union returned by {@link useToolContext}: tool arguments (partial
 * while streaming, complete otherwise), result payload when ready, and lifecycle
 * status for the current tool call.
 *
 * Status derivation order: result → `"ready"`; else cancelled → `"cancelled"`;
 * else streaming → `"streaming"`; else `"pending"`.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}; defaults to
 * `never` (untyped) when omitted.
 */
export type ToolContextHandle<Name extends keyof RegisteredTools = never> =
  | {
      /**
       * No result yet and arguments are not mid-stream. Covers both "nothing
       * arrived" and "complete input received, awaiting result" —
       * {@link ToolContextHandle.toolInput} is the complete args when delivered.
       */
      status: "pending";
      /** Complete tool arguments when delivered; otherwise `undefined`. */
      toolInput: ToolInput<Name> | undefined;
      /** Always `undefined` until a result arrives. */
      toolOutput: undefined;
      /** Always `undefined` until a result arrives. */
      content: undefined;
      /** Always `undefined` until a result arrives. */
      meta: undefined;
      /** Absent outside `"cancelled"`. */
      reason?: undefined;
    }
  | {
      /**
       * Partial args are arriving; {@link ToolContextHandle.toolInput} grows
       * progressively and is typed `DeepPartial` (provisional, render-only —
       * strings may be truncated mid-token).
       */
      status: "streaming";
      /** Progressive tool arguments (`DeepPartial`); last write wins. */
      toolInput: DeepPartial<ToolInput<Name>> | undefined;
      /** Always `undefined` until a result arrives. */
      toolOutput: undefined;
      /** Always `undefined` until a result arrives. */
      content: undefined;
      /** Always `undefined` until a result arrives. */
      meta: undefined;
      /** Absent outside `"cancelled"`. */
      reason?: undefined;
    }
  | {
      /**
       * Host sent `ui/notifications/tool-cancelled` (host MUST send on any
       * cancellation — user action, sampling error, classifier intervention).
       * {@link ToolContextHandle.toolInput} may be partial if cancelled mid-stream.
       */
      status: "cancelled";
      /** Last args before cancel — may be partial (`DeepPartial`). */
      toolInput: DeepPartial<ToolInput<Name>> | undefined;
      /** Always `undefined` after cancellation (no result). */
      toolOutput: undefined;
      /** Always `undefined` after cancellation (no result). */
      content: undefined;
      /** Always `undefined` after cancellation (no result). */
      meta: undefined;
      /** Optional host-provided cancellation reason. */
      reason: string | undefined;
    }
  | {
      /** Result arrived; render from {@link ToolContextHandle.toolOutput}. */
      status: "ready";
      /** Complete tool arguments from the host, when delivered. */
      toolInput: ToolInput<Name> | undefined;
      /** Model-visible tool output from the host's `structuredContent`. */
      toolOutput: ToolOutput<Name>;
      /** Model-visible content blocks from the tool result. */
      content: ContentBlock[] | undefined;
      /** View-only result `_meta`, when present. */
      meta: Record<string, unknown> | undefined;
      /** Absent outside `"cancelled"`. */
      reason?: undefined;
    };

/**
 * Primary data hook for view components: tool arguments (streaming into a single
 * {@link ToolContextHandle.toolInput} field), result payload, and lifecycle status
 * for the bound tool call.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}; defaults to
 * `never` (untyped) when omitted.
 *
 * @example
 * ```tsx
 * function ProductSearchResult() {
 *   const { status, toolInput, toolOutput } = useToolContext<"search-fruits">();
 *
 *   if (status !== "ready") {
 *     return (
 *       <div aria-busy={status === "streaming"}>
 *         Searching {toolInput?.query ?? "…"}
 *       </div>
 *     );
 *   }
 *
 *   return (
 *     <ul>
 *       {toolOutput.items.map((item) => (
 *         <li key={item.id}>{item.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useToolContext<
  Name extends keyof RegisteredTools = never,
>(): ToolContextHandle<Name> {
  const snap = useViewBridgeSnapshot();

  if (snap.hasToolResult) {
    return {
      status: "ready",
      toolInput: snap.toolInput as ToolInput<Name> | undefined,
      toolOutput: snap.toolOutput as ToolOutput<Name>,
      content: snap.content,
      meta: snap.meta,
    };
  }

  if (snap.cancelled !== undefined) {
    return {
      status: "cancelled",
      toolInput: snap.toolInput as DeepPartial<ToolInput<Name>> | undefined,
      toolOutput: undefined,
      content: undefined,
      meta: undefined,
      reason: snap.cancelled.reason,
    };
  }

  if (snap.isStreaming) {
    return {
      status: "streaming",
      toolInput: snap.toolInput as DeepPartial<ToolInput<Name>> | undefined,
      toolOutput: undefined,
      content: undefined,
      meta: undefined,
    };
  }

  return {
    status: "pending",
    toolInput: snap.toolInput as ToolInput<Name> | undefined,
    toolOutput: undefined,
    content: undefined,
    meta: undefined,
  };
}
