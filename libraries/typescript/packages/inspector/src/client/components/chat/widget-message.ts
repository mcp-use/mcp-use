import type { MessageContentBlock } from "@/client/types/message-content-block";
import type { MessageAttachment } from "./types";

export const MAX_WIDGET_IMAGE_SIZE = 10 * 1024 * 1024;
export const MAX_WIDGET_MESSAGE_SIZE = 20 * 1024 * 1024;

const SUPPORTED_WIDGET_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

interface NormalizedWidgetMessage {
  /** Full model-facing text, including model-only blocks. */
  text: string;
  /** All images; model-only ones carry `modelOnly: true`. */
  attachments: MessageAttachment[];
  /**
   * Text to show in the conversation. Present only when at least one text
   * block is model-only; otherwise the whole `text` is shown.
   */
  displayText?: string;
}

/**
 * Whether a content block should be shown to the user.
 *
 * MCP `annotations.audience` lists who the content is for. A block is hidden
 * from the conversation only when `audience` is a valid role array
 * (`"user"` / `"assistant"` entries only) that omits `"user"`. A missing or
 * malformed `audience`, including one with unknown roles, keeps the block
 * visible.
 */
export function isVisibleToUser(block: MessageContentBlock): boolean {
  const annotations = (block as { annotations?: unknown }).annotations;
  if (!annotations || typeof annotations !== "object") return true;
  const audience = (annotations as { audience?: unknown }).audience;
  if (!Array.isArray(audience)) return true;
  if (audience.some((role) => role !== "user" && role !== "assistant")) {
    return true;
  }
  return audience.includes("user");
}

export function validateWidgetImageSizes(sizes: readonly number[]): void {
  for (const size of sizes) {
    if (size > MAX_WIDGET_IMAGE_SIZE) {
      throw new Error("ui/message image exceeds the 10 MB per-file limit");
    }
  }
  if (
    sizes.reduce((total, size) => total + size, 0) > MAX_WIDGET_MESSAGE_SIZE
  ) {
    throw new Error("ui/message images exceed the 20 MB total limit");
  }
}

function getBase64ByteLength(data: string): number {
  const normalized = data.replace(/\s/g, "");
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error("ui/message image data must be valid base64");
  }

  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

export function normalizeWidgetMessage(
  content: readonly MessageContentBlock[]
): NormalizedWidgetMessage {
  if (content.length === 0) {
    throw new Error("ui/message requires at least one content block");
  }

  const textParts: string[] = [];
  const visibleTextParts: string[] = [];
  const attachments: MessageAttachment[] = [];

  for (const [index, block] of content.entries()) {
    if (block.type === "text") {
      if (typeof block.text !== "string") {
        throw new Error(`ui/message text block ${index} is invalid`);
      }
      textParts.push(block.text);
      if (isVisibleToUser(block)) visibleTextParts.push(block.text);
      continue;
    }

    if (block.type === "image") {
      if (
        typeof block.data !== "string" ||
        typeof block.mimeType !== "string"
      ) {
        throw new Error(`ui/message image block ${index} is invalid`);
      }
      if (!SUPPORTED_WIDGET_IMAGE_TYPES.has(block.mimeType)) {
        throw new Error(`Unsupported ui/message image type: ${block.mimeType}`);
      }

      const size = getBase64ByteLength(block.data);
      validateWidgetImageSizes([
        ...attachments.map((attachment) => attachment.size ?? 0),
        size,
      ]);

      attachments.push({
        type: "image",
        data: block.data,
        mimeType: block.mimeType,
        name: `widget-image-${attachments.length + 1}`,
        size,
        ...(isVisibleToUser(block) ? {} : { modelOnly: true }),
      });
      continue;
    }

    throw new Error(
      `Unsupported ui/message content block: ${block.type || "unknown"}`
    );
  }

  const text = textParts.join("\n");
  if (!text.trim() && attachments.length === 0) {
    throw new Error("ui/message must include text or an image");
  }

  return visibleTextParts.length === textParts.length
    ? { text, attachments }
    : { text, attachments, displayText: visibleTextParts.join("\n") };
}
