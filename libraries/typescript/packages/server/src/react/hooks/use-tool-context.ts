import type { ContentBlock } from "@modelcontextprotocol/server";
import { useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { DeepPartial, RegisteredTools } from "../types/register.js";
import type { ToolContextError } from "../types/result-types.js";

export type { ToolContextError } from "../types/result-types.js";

type ToolOutput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["output"]
  : unknown;

type ToolInput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["input"]
  : unknown;

/**
 * No result yet and arguments are not mid-stream.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}.
 */
interface PendingToolContext<Name extends keyof RegisteredTools> {
  /**
   * No result yet and arguments are not mid-stream. Covers both "nothing
   * arrived" and "complete input received, awaiting result" —
   * {@link ToolContextHandle.toolInput} is the complete args when delivered.
   */
  status: "pending";
  /** Complete tool arguments when delivered; otherwise `undefined`. */
  toolInput: ToolInput<Name> | undefined;
  /** Always `undefined` until a ready result arrives. */
  toolOutput: undefined;
  /** Always `undefined` until a ready or error result arrives. */
  content: undefined;
  /** Always `undefined` until a ready or error result arrives. */
  meta: undefined;
  /** Absent outside `"cancelled"`. */
  reason?: undefined;
  /** Absent outside `"error"`. */
  error?: undefined;
}

/**
 * Partial args are arriving.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}.
 */
interface StreamingToolContext<Name extends keyof RegisteredTools> {
  /**
   * Partial args are arriving; {@link ToolContextHandle.toolInput} grows
   * progressively and is typed `DeepPartial` (provisional, render-only —
   * strings may be truncated mid-token).
   */
  status: "streaming";
  /** Progressive tool arguments (`DeepPartial`); last write wins. */
  toolInput: DeepPartial<ToolInput<Name>> | undefined;
  /** Always `undefined` until a ready result arrives. */
  toolOutput: undefined;
  /** Always `undefined` until a ready or error result arrives. */
  content: undefined;
  /** Always `undefined` until a ready or error result arrives. */
  meta: undefined;
  /** Absent outside `"cancelled"`. */
  reason?: undefined;
  /** Absent outside `"error"`. */
  error?: undefined;
}

/**
 * Host cancelled the current tool call.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}.
 */
interface CancelledToolContext<Name extends keyof RegisteredTools> {
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
  /** Absent outside `"error"`. */
  error?: undefined;
}

/**
 * Non-error result with `structuredContent` — typed output is available.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}.
 */
interface ReadyToolContext<Name extends keyof RegisteredTools> {
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
  /** Absent outside `"error"`. */
  error?: undefined;
}

/**
 * Tool error or invalid non-error result — never cast to typed output.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}.
 */
interface ErrorToolContext<Name extends keyof RegisteredTools> {
  /** Valid tool error or malformed non-error result. */
  status: "error";
  /** Complete tool arguments from the host, when delivered. */
  toolInput: ToolInput<Name> | undefined;
  /** Always `undefined` on the error branch — never typed output. */
  toolOutput: undefined;
  /** Content blocks from the result, when present. */
  content: ContentBlock[] | undefined;
  /** View-only result `_meta`, when present. */
  meta: Record<string, unknown> | undefined;
  /** Absent outside `"cancelled"`. */
  reason?: undefined;
  /** Discriminated tool vs invalid-result payload. */
  error: ToolContextError;
}

/**
 * Discriminated union returned by {@link useToolContext}: tool arguments
 * (partial while streaming, complete otherwise), typed result payload when
 * ready, and lifecycle status for the current tool call.
 *
 * Status derivation order: error → ready → cancelled → streaming → pending.
 * The `"ready"` branch is available only for a non-error result with
 * `structuredContent`. There is no `toolName` field — the view has one bound
 * tool, so the generic `Name` selects input/output types.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}; defaults to
 * `never` (untyped) when omitted.
 */
export type ToolContextHandle<Name extends keyof RegisteredTools = never> =
  | PendingToolContext<Name>
  | StreamingToolContext<Name>
  | CancelledToolContext<Name>
  | ReadyToolContext<Name>
  | ErrorToolContext<Name>;

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
 *   const view = useToolContext<"search-fruits">();
 *
 *   if (view.status === "error") {
 *     if (view.error.kind === "tool") {
 *       return <ToolError content={view.content} />;
 *     }
 *     return <InvalidResult message={view.error.message} />;
 *   }
 *
 *   if (view.status !== "ready") {
 *     return (
 *       <div aria-busy={view.status === "streaming"}>
 *         Searching {view.toolInput?.query ?? "…"}
 *       </div>
 *     );
 *   }
 *
 *   return (
 *     <ul>
 *       {view.toolOutput.items.map((item) => (
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
  const runtime = useViewRuntime();
  const snap = useSyncExternalStore(
    runtime.subscribeTool,
    runtime.getToolSnapshot
  );

  if (snap.error !== undefined) {
    return {
      status: "error",
      toolInput: snap.toolInput as ToolInput<Name> | undefined,
      toolOutput: undefined,
      content: snap.content,
      meta: snap.meta,
      error: snap.error,
    };
  }

  if (snap.hasToolResult) {
    return {
      status: "ready",
      toolInput: snap.toolInput as ToolInput<Name> | undefined,
      toolOutput: snap.toolOutput as ToolOutput<Name>,
      content: snap.content,
      meta: snap.meta,
    } as ToolContextHandle<Name>;
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
