import type { ContentBlock } from "@modelcontextprotocol/server";
import { useSyncExternalStore } from "react";

import { useViewRuntime } from "../runtime/view-runtime-context.js";
import type { DeepPartial, RegisteredTools } from "../types/register.js";
import type { ToolContextError } from "../types/result-types.js";

export type { ToolContextError } from "../types/result-types.js";

type ToolOutput<Name extends keyof RegisteredTools> =
  Name extends keyof RegisteredTools
    ? RegisteredTools[Name]["output"]
    : unknown;

type ToolInput<Name extends keyof RegisteredTools> =
  Name extends keyof RegisteredTools ? RegisteredTools[Name]["input"] : unknown;

/** No structured result has been latched yet. */
interface PendingToolContext<Name extends keyof RegisteredTools> {
  status: "pending";
  /** Latest complete or partial arguments; each notification replaces it. */
  toolInput: DeepPartial<ToolInput<Name>> | undefined;
  toolOutput: undefined;
  content: undefined;
  meta: undefined;
  error?: undefined;
}

/** First non-error result carrying `structuredContent`. */
interface ReadyToolContext<Name extends keyof RegisteredTools> {
  status: "ready";
  /** Latest arguments delivered before the result, when available. */
  toolInput: ToolInput<Name> | undefined;
  /** Typed `structuredContent` from the latched rendering result. */
  toolOutput: ToolOutput<Name>;
  content: ContentBlock[] | undefined;
  /** View-only result `_meta`, when present. */
  meta: Record<string, unknown> | undefined;
  error?: undefined;
}

/** First tool result carrying `isError: true`. */
interface ErrorToolContext<Name extends keyof RegisteredTools> {
  status: "error";
  /** Latest arguments delivered before the error, when available. */
  toolInput: ToolInput<Name> | undefined;
  toolOutput: undefined;
  content: ContentBlock[] | undefined;
  meta: Record<string, unknown> | undefined;
  error: ToolContextError;
}

/**
 * The rendering invocation's latched lifecycle.
 *
 * Partial and complete input notifications replace the same `toolInput`
 * snapshot while pending. Because the MCP Apps notification has no tool name
 * or request id, the first structured result or tool error is assumed to
 * belong to the rendering invocation and becomes terminal. Content-only
 * successes are valid ambient activity and are ignored.
 */
export type ToolContextHandle<Name extends keyof RegisteredTools = never> =
  | PendingToolContext<Name>
  | ReadyToolContext<Name>
  | ErrorToolContext<Name>;

/**
 * Read the tool invocation that rendered this View.
 *
 * The hook starts pending with an optional progressive `toolInput`, then
 * latches the first structured success or tool error for the View's lifetime.
 * Later lifecycle notifications cannot overwrite that terminal context.
 *
 * @example
 * ```tsx
 * function ProductSearchResult() {
 *   const view = useToolContext<"search-fruits">();
 *
 *   if (view.status === "error") {
 *     return <ToolErrorBanner message={view.error.message} />;
 *   }
 *   if (view.status === "pending") {
 *     return <SearchSkeleton query={view.toolInput?.query} />;
 *   }
 *   return <Results items={view.toolOutput.items} />;
 * }
 * ```
 */
export function useToolContext<
  Name extends keyof RegisteredTools = never,
>(): ToolContextHandle<Name> {
  const runtime = useViewRuntime("useToolContext");
  const snap = useSyncExternalStore(
    runtime.subscribeTool,
    runtime.getToolSnapshot
  );

  if (snap.status === "error") {
    return {
      status: "error",
      toolInput: snap.toolInput as ToolInput<Name> | undefined,
      toolOutput: undefined,
      content: snap.content,
      meta: snap.meta,
      error: snap.error as ToolContextError,
    };
  }

  if (snap.status === "ready") {
    return {
      status: "ready",
      toolInput: snap.toolInput as ToolInput<Name> | undefined,
      toolOutput: snap.toolOutput as ToolOutput<Name>,
      content: snap.content,
      meta: snap.meta,
    };
  }

  return {
    status: "pending",
    toolInput: snap.toolInput as DeepPartial<ToolInput<Name>> | undefined,
    toolOutput: undefined,
    content: undefined,
    meta: undefined,
  };
}
