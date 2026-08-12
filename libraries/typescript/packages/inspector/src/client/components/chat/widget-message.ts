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
  text: string;
  attachments: MessageAttachment[];
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
  const attachments: MessageAttachment[] = [];

  for (const [index, block] of content.entries()) {
    if (block.type === "text") {
      if (typeof block.text !== "string") {
        throw new Error(`ui/message text block ${index} is invalid`);
      }
      textParts.push(block.text);
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

  return { text, attachments };
}
