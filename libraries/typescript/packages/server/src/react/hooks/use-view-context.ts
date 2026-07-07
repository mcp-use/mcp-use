import type { ContentBlock } from "@modelcontextprotocol/server";

import { useViewBridgeSnapshot } from "../bridge/view-bridge.js";
import type { DeepPartial, RegisteredTools } from "../types/register.js";

type ToolOutput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["output"]
  : unknown;

type ToolInput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? RegisteredTools[Name]["input"]
  : unknown;

type PartialToolInput<Name extends keyof RegisteredTools> = Name extends keyof RegisteredTools
  ? DeepPartial<RegisteredTools[Name]["input"]>
  : unknown;

/**
 * Discriminated union returned by {@link useViewContext}: tool output, streaming
 * partials, and lifecycle status for the current tool call.
 */
export type ViewContextHandle<Name extends keyof RegisteredTools = never> =
  | {
      /** Result payload is available — render from {@link ViewContextHandle.toolOutput}. */
      status: "ready";
      /** Model-visible tool output from the host's `structuredContent`. */
      toolOutput: ToolOutput<Name>;
      /** Model-visible content blocks from the tool result. */
      content: ContentBlock[] | undefined;
      /** View-only result `_meta`, when present. */
      meta: Record<string, unknown> | undefined;
      /** Complete tool arguments from the host. */
      toolInput: ToolInput<Name> | undefined;
      /** Always `undefined` once a result arrives. */
      partialToolInput: undefined;
    }
  | {
      /** Tool arguments are streaming — render a skeleton from {@link ViewContextHandle.partialToolInput}. */
      status: "streaming";
      /** Always `undefined` until a result arrives. */
      toolOutput: undefined;
      /** Always `undefined` until a result arrives. */
      content: undefined;
      /** Always `undefined` until a result arrives. */
      meta: undefined;
      /** Progressively parsed tool arguments. */
      partialToolInput: PartialToolInput<Name> | undefined;
      /** Complete tool arguments from the host, when already delivered. */
      toolInput: ToolInput<Name> | undefined;
    }
  | {
      /** Before the first result — no output payload yet. */
      status: "pending";
      /** Always `undefined` until a result arrives. */
      toolOutput: undefined;
      /** Always `undefined` until a result arrives. */
      content: undefined;
      /** Always `undefined` until a result arrives. */
      meta: undefined;
      /** Progressive partials, if any arrived before streaming ended. */
      partialToolInput: PartialToolInput<Name> | undefined;
      /** Complete tool arguments from the host, when already delivered. */
      toolInput: ToolInput<Name> | undefined;
    };

/**
 * Primary data hook for view components: tool output, streaming partials, and
 * lifecycle status for the bound tool call.
 *
 * @example
 * ```tsx
 * function ProductSearchResult() {
 *   const { status, toolOutput, partialToolInput } = useViewContext<"search-fruits">();
 *
 *   if (status !== "ready") {
 *     return (
 *       <div aria-busy={status === "streaming"}>
 *         Searching {partialToolInput?.query ?? "…"}
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
export function useViewContext<
  Name extends keyof RegisteredTools = never,
>(): ViewContextHandle<Name> {
  const snap = useViewBridgeSnapshot();

  const toolInput = snap.toolInput as ToolInput<Name> | undefined;

  if (snap.hasToolResult) {
    return {
      status: "ready",
      toolOutput: snap.toolOutput as ToolOutput<Name>,
      content: snap.content,
      partialToolInput: undefined,
      meta: snap.meta,
      toolInput,
    };
  }

  if (snap.isStreaming) {
    return {
      status: "streaming",
      toolOutput: undefined,
      content: undefined,
      partialToolInput: snap.partialToolInput as PartialToolInput<Name> | undefined,
      meta: undefined,
      toolInput,
    };
  }

  return {
    status: "pending",
    toolOutput: undefined,
    content: undefined,
    partialToolInput: snap.partialToolInput as PartialToolInput<Name> | undefined,
    meta: undefined,
    toolInput,
  };
}
