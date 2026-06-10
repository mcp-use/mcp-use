import type { ContentPart, ImageContentPart, TextContentPart } from "./types";

/**
 * Convert an MCP tool result into a provider-neutral `ContentPart[]` (or a
 * collapsed string when every part is text). Image content blocks become
 * `ImageContentPart`s so vision-capable providers can forward the pixels;
 * `JSON.stringify`ing them would silently bury base64 bytes inside a text
 * payload that the model cannot decode.
 */

interface McpContentText {
  type: "text";
  text: string;
}
interface McpContentImage {
  type: "image";
  data: string;
  mimeType: string;
}
interface McpContentAudio {
  type: "audio";
  data: string;
  mimeType: string;
}
interface McpContentResource {
  type: "resource";
  resource: {
    uri?: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}
interface McpContentResourceLink {
  type: "resource_link";
  uri?: string;
  name?: string;
  mimeType?: string;
}

type McpContentBlock =
  | McpContentText
  | McpContentImage
  | McpContentAudio
  | McpContentResource
  | McpContentResourceLink
  | { type: string; [k: string]: unknown };

interface McpToolResult {
  content?: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

function makeText(text: string): TextContentPart {
  return { type: "text", text };
}

function makeImage(data: string, mimeType: string): ImageContentPart {
  return {
    type: "image",
    url: `data:${mimeType};base64,${data}`,
    mimeType,
    data,
  };
}

function isMcpResultShape(value: unknown): value is McpToolResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.content)) return true;
  return "structuredContent" in v;
}

/**
 * Returns true when a tool result carries the MCP `isError: true` flag.
 * Used by both the live tool loop and the replay path so a tool that
 * successfully returns `{ isError: true, content: [...] }` is treated the
 * same as one that threw.
 */
export function isToolResultError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

function blockToPart(block: McpContentBlock): ContentPart | null {
  if (!block || typeof block !== "object") return null;
  switch (block.type) {
    case "text": {
      const text = (block as McpContentText).text;
      return typeof text === "string" && text.length > 0
        ? makeText(text)
        : null;
    }
    case "image": {
      const b = block as McpContentImage;
      if (typeof b.data !== "string" || !b.data) return null;
      const mime =
        typeof b.mimeType === "string" && b.mimeType ? b.mimeType : "image/png";
      return makeImage(b.data, mime);
    }
    case "audio": {
      // Audio is not yet forwarded; emit a marker so the model still sees
      // that audio was returned.
      const b = block as McpContentAudio;
      const mime =
        typeof b.mimeType === "string" && b.mimeType ? b.mimeType : "audio/*";
      const bytes = typeof b.data === "string" ? b.data.length : 0;
      return makeText(`[audio: ${mime}, base64 omitted (${bytes} chars)]`);
    }
    case "resource": {
      const r = (block as McpContentResource).resource ?? {};
      if (typeof r.text === "string" && r.text.length > 0) {
        return makeText(r.text);
      }
      if (
        typeof r.blob === "string" &&
        typeof r.mimeType === "string" &&
        r.mimeType.startsWith("image/")
      ) {
        return makeImage(r.blob, r.mimeType);
      }
      const uri = typeof r.uri === "string" ? r.uri : "<unknown>";
      const mime = typeof r.mimeType === "string" ? r.mimeType : "unknown";
      return makeText(`[resource: ${uri} (${mime})]`);
    }
    case "resource_link": {
      const b = block as McpContentResourceLink;
      const uri = typeof b.uri === "string" ? b.uri : "<unknown>";
      const name = typeof b.name === "string" ? ` "${b.name}"` : "";
      return makeText(`[resource_link${name}: ${uri}]`);
    }
    default: {
      // Unknown block type — emit a short marker rather than stringifying the
      // whole thing (which may contain base64 payloads we want to keep out of
      // the text channel).
      return makeText(
        `[unsupported tool content block: ${String(block.type)}]`
      );
    }
  }
}

function stripMeta(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { _meta: _ignored, ...rest } = value as Record<string, unknown>;
    return rest;
  }
  return value;
}

export function extractToolResultParts(result: unknown): ContentPart[] {
  const stripped = stripMeta(result);

  if (typeof stripped === "string") {
    return stripped.length > 0 ? [makeText(stripped)] : [];
  }

  if (isMcpResultShape(stripped)) {
    const r = stripped as McpToolResult;
    const parts: ContentPart[] = [];
    if (Array.isArray(r.content)) {
      for (const block of r.content) {
        const p = blockToPart(block);
        if (p) parts.push(p);
      }
    }
    if (r.structuredContent !== undefined) {
      try {
        parts.push(
          makeText(`structuredContent: ${JSON.stringify(r.structuredContent)}`)
        );
      } catch {
        // ignore — non-serializable structuredContent is exotic enough that we
        // prefer to drop it than to blow up the request.
      }
    }
    if (r.isError) {
      parts.unshift(makeText("[tool reported isError=true]"));
    }
    return parts;
  }

  // Fallback: arbitrary value (object or array). Stringify into one text part.
  try {
    return [makeText(JSON.stringify(stripped))];
  } catch {
    return [makeText(String(stripped))];
  }
}

/**
 * Collapse a `ContentPart[]` to a single string if every part is a text part —
 * lets callers preserve the legacy `content: string` shape for the common case
 * of text-only tool results.
 */
function collapseToString(parts: ContentPart[]): string | null {
  if (parts.length === 0) return "";
  if (parts.every((p) => p.type === "text")) {
    return parts.map((p) => (p as TextContentPart).text).join("\n");
  }
  return null;
}

/**
 * Convenience wrapper used by `toolLoop` and `messageFormat`: returns a string
 * for text-only results and a `ContentPart[]` when any non-text part (currently
 * just images) is present.
 */
export function toolResultToContent(result: unknown): string | ContentPart[] {
  const parts = extractToolResultParts(result);
  const collapsed = collapseToString(parts);
  return collapsed !== null ? collapsed : parts;
}

/**
 * Split a tool-message `content` field into joined text + image parts. Used by
 * providers (OpenAI, Gemini) that can't carry image bytes inside their tool
 * role and must forward them as a synthetic follow-up user turn.
 */
export function partitionToolContent(content: string | ContentPart[]): {
  text: string;
  imageParts: ImageContentPart[];
  isString: boolean;
} {
  if (typeof content === "string") {
    return { text: content, imageParts: [], isString: true };
  }
  const texts: string[] = [];
  const imageParts: ImageContentPart[] = [];
  for (const p of content) {
    if (p.type === "text") {
      if (p.text) texts.push(p.text);
    } else if (p.type === "image") {
      imageParts.push(p);
    }
  }
  return { text: texts.join("\n"), imageParts, isString: false };
}

/** Header text introducing image bytes that follow a tool result. */
export function toolImageFollowupHeader(
  toolName: string | undefined,
  count: number
): string {
  return `(Tool "${toolName ?? "<tool>"}" returned the following image${
    count === 1 ? "" : "s"
  }:)`;
}
