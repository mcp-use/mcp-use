import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/server";

/**
 * Build a tool result for a view-bound tool, naming the three result channels.
 *
 * `props` become `structuredContent` (model + view); `content` is the
 * model/text-host narrative; `meta` passes through to `_meta` for the view
 * only.
 *
 * @param args - Channel payloads.
 * @returns A plain {@link CallToolResult} with `structuredContent` set.
 *
 * @example
 * ```ts
 * return view({
 *   props: { query, items },
 *   content: `Found ${items.length} items`,
 *   meta: { highlightId: items[0]?.id },
 * });
 * ```
 */
export function view<TOutput>(args: {
  props: TOutput;
  content?: string | ContentBlock[];
  meta?: Record<string, unknown>;
}): CallToolResult & { structuredContent: TOutput } {
  const content =
    args.content === undefined
      ? [{ type: "text" as const, text: JSON.stringify(args.props) }]
      : typeof args.content === "string"
        ? [{ type: "text" as const, text: args.content }]
        : args.content;

  return {
    content,
    structuredContent: args.props,
    ...(args.meta !== undefined && { _meta: args.meta }),
  };
}
