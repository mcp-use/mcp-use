import type {
  BlobResourceContents,
  CallToolResult,
  ContentBlock,
  GetPromptResult,
  PromptMessage,
  ReadResourceResult,
  TextResourceContents,
} from "@modelcontextprotocol/server";

type ResourceContentsEntry = TextResourceContents | BlobResourceContents;

/**
 * True when `result` is already a {@link ReadResourceResult} (`contents` array).
 *
 * @param result - Resource or tool-shaped result.
 * @returns Whether the value has a `contents` array.
 */
function isReadResourceResult(
  result: CallToolResult | ReadResourceResult
): result is ReadResourceResult {
  return "contents" in result && Array.isArray(result.contents);
}

/**
 * True when `result` is already a {@link GetPromptResult} (`messages` array).
 *
 * @param result - Prompt or tool-shaped result.
 * @returns Whether the value has a `messages` array.
 */
function isGetPromptResult(
  result: CallToolResult | GetPromptResult
): result is GetPromptResult {
  return "messages" in result && Array.isArray(result.messages);
}

/**
 * Convert a helper/`CallToolResult` (or pass through a raw resource result) to
 * {@link ReadResourceResult}.
 *
 * Maps official {@link ContentBlock}s: `text` → text contents, `image`/`audio`
 * `data` → `blob`, embedded `resource` → unwrap, `resource_link` skipped.
 * Empty `content` with `structuredContent` becomes a JSON text entry.
 *
 * @param result - Tool-shaped or resource result from a resource callback.
 * @param uri - URI of the resource being read (used for synthesized entries).
 * @returns Official resource read envelope.
 */
export function toResourceResult(
  result: CallToolResult | ReadResourceResult,
  uri: string
): ReadResourceResult {
  if (isReadResourceResult(result)) {
    return result;
  }

  const mime =
    result._meta &&
    typeof result._meta === "object" &&
    typeof (result._meta as { mimeType?: unknown }).mimeType === "string"
      ? (result._meta as { mimeType: string }).mimeType
      : undefined;

  const contents: ResourceContentsEntry[] = [];

  for (const block of result.content ?? []) {
    const mapped = contentBlockToResourceContents(block, uri, mime);
    if (mapped !== undefined) {
      contents.push(mapped);
    }
  }

  if (contents.length === 0 && result.structuredContent !== undefined) {
    contents.push({
      uri,
      mimeType: "application/json",
      text: JSON.stringify(result.structuredContent),
    });
  }

  if (contents.length === 0) {
    contents.push({ uri, mimeType: "text/plain", text: "" });
  }

  return { contents };
}

/**
 * Map one {@link ContentBlock} to resource contents, or `undefined` to skip.
 *
 * @param block - Tool content block.
 * @param uri - Default URI when the block does not carry one.
 * @param mimeHint - Optional MIME from tool result `_meta.mimeType`.
 * @returns Resource contents entry, or `undefined` for non-embeddable blocks.
 */
function contentBlockToResourceContents(
  block: ContentBlock,
  uri: string,
  mimeHint: string | undefined
): ResourceContentsEntry | undefined {
  if (block.type === "text") {
    return {
      uri,
      mimeType: mimeHint ?? "text/plain",
      text: block.text,
    };
  }
  if (block.type === "image" || block.type === "audio") {
    return {
      uri,
      mimeType: block.mimeType,
      blob: block.data,
    };
  }
  if (block.type === "resource") {
    return { ...block.resource };
  }
  // resource_link is a pointer, not readable contents
  return undefined;
}

/**
 * Convert a helper/`CallToolResult` (or pass through a raw prompt result) to
 * {@link GetPromptResult}.
 *
 * Each tool {@link ContentBlock} becomes a `user` {@link PromptMessage}
 * (prompt messages already accept the same content-block union).
 *
 * @param result - Tool-shaped or prompt result from a prompt callback.
 * @returns Official prompt get envelope.
 */
export function toPromptResult(
  result: CallToolResult | GetPromptResult
): GetPromptResult {
  if (isGetPromptResult(result)) {
    return result;
  }

  const messages: PromptMessage[] = (result.content ?? []).map((content) => ({
    role: "user" as const,
    content,
  }));

  if (messages.length === 0 && result.structuredContent !== undefined) {
    messages.push({
      role: "user",
      content: {
        type: "text",
        text: JSON.stringify(result.structuredContent),
      },
    });
  }

  if (messages.length === 0) {
    messages.push({
      role: "user",
      content: { type: "text", text: "" },
    });
  }

  return { messages };
}
