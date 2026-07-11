import type { ContentBlock } from "@modelcontextprotocol/server";
import { useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { DeepPartial, RegisteredTools } from "../types/register.js";

type ToolOutput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["output"]
  : unknown;

type ToolInput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["input"]
  : unknown;

/**
 * Last-known calling tool name on non-ready branches.
 *
 * Seeded from host context; may lag until the first result. Input notifications
 * carry no tool identity, so during streaming this is informational — not a
 * type discriminant.
 *
 * @typeParam Name - Bound tool name(s) from {@link RegisteredTools}.
 */
type ToolNameField<Name extends keyof RegisteredTools> = [Name] extends [never]
  ? string | undefined
  : Name | undefined;

/**
 * Ready-branch shape for {@link ToolContextHandle}.
 *
 * Distributes over a union of tool names so `toolName` and `toolOutput` pair
 * per member (narrowing on `toolName` narrows `toolOutput`). When `Name` is
 * `never` (untyped), collapses to a single branch with
 * `toolName: string | undefined` so untyped usage keeps compiling.
 *
 * @typeParam Name - Bound tool name(s) from {@link RegisteredTools}.
 */
type ReadyToolContext<Name extends keyof RegisteredTools> = [Name] extends [never]
  ? {
      /** Result arrived; render from {@link ToolContextHandle.toolOutput}. */
      status: "ready";
      /**
       * Calling tool name — seeded from host context, authoritatively updated
       * from result `_meta["mcp-use/toolName"]`.
       */
      toolName: string | undefined;
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
    }
  : Name extends unknown
    ? {
        /** Result arrived; render from {@link ToolContextHandle.toolOutput}. */
        status: "ready";
        /**
         * Calling tool name for this result — pairs with {@link ToolContextHandle.toolOutput}
         * so narrowing on the literal narrows the output type.
         */
        toolName: Name;
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
      }
    : never;

/**
 * Discriminated union returned by {@link useToolContext}: tool arguments (partial
 * while streaming, complete otherwise), result payload when ready, and lifecycle
 * status for the current tool call.
 *
 * Status derivation order: result → `"ready"`; else cancelled → `"cancelled"`;
 * else streaming → `"streaming"`; else `"pending"`.
 *
 * When `Name` is a union of registered tool names, the `"ready"` branch
 * distributes so `toolName` acts as a discriminant for `toolOutput`.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}; defaults to
 * `never` (untyped) when omitted. May be a union for multi-tool views.
 */
export type ToolContextHandle<Name extends keyof RegisteredTools = never> =
  | {
      /**
       * No result yet and arguments are not mid-stream. Covers both "nothing
       * arrived" and "complete input received, awaiting result" —
       * {@link ToolContextHandle.toolInput} is the complete args when delivered.
       */
      status: "pending";
      /**
       * Last known calling tool — seeded from host context, may lag until the
       * first result; input notifications carry no tool identity so this is
       * informational, not a type discriminant.
       */
      toolName: ToolNameField<Name>;
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
      /**
       * Last known calling tool — seeded from host context, may lag until the
       * first result; input notifications carry no tool identity so during
       * streaming this is informational, not a type discriminant.
       */
      toolName: ToolNameField<Name>;
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
      /**
       * Last known calling tool — seeded from host context, may lag until the
       * first result; input notifications carry no tool identity so this is
       * informational, not a type discriminant.
       */
      toolName: ToolNameField<Name>;
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
  | ReadyToolContext<Name>;

/**
 * Primary data hook for view components: tool arguments (streaming into a single
 * {@link ToolContextHandle.toolInput} field), result payload, and lifecycle status
 * for the bound tool call.
 *
 * @typeParam Name - Bound tool name from {@link RegisteredTools}; defaults to
 * `never` (untyped) when omitted. Pass a union (e.g. `"draw" | "refresh"`) for
 * multi-tool views — in the `"ready"` branch, narrow on `toolName` to refine
 * `toolOutput`.
 *
 * @example
 * ```tsx
 * function ProductSearchResult() {
 *   const view = useToolContext<"search-fruits">();
 *
 *   if (view.status !== "ready") {
 *     return (
 *       <div aria-busy={view.status === "streaming"}>
 *         Searching {view.toolInput?.query ?? "…"}
 *       </div>
 *     );
 *   }
 *
 *   // Single-name: toolName is the literal "search-fruits".
 *   // With a union Name, narrow: if (view.toolName === "search-fruits") { … }
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

  if (snap.hasToolResult) {
    return {
      status: "ready",
      toolName: snap.toolName as ReadyToolContext<Name>["toolName"],
      toolInput: snap.toolInput as ToolInput<Name> | undefined,
      toolOutput: snap.toolOutput as ToolOutput<Name>,
      content: snap.content,
      meta: snap.meta,
    } as ToolContextHandle<Name>;
  }

  if (snap.cancelled !== undefined) {
    return {
      status: "cancelled",
      toolName: snap.toolName as ToolNameField<Name>,
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
      toolName: snap.toolName as ToolNameField<Name>,
      toolInput: snap.toolInput as DeepPartial<ToolInput<Name>> | undefined,
      toolOutput: undefined,
      content: undefined,
      meta: undefined,
    };
  }

  return {
    status: "pending",
    toolName: snap.toolName as ToolNameField<Name>,
    toolInput: snap.toolInput as ToolInput<Name> | undefined,
    toolOutput: undefined,
    content: undefined,
    meta: undefined,
  };
}
