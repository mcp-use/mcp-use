import type { Message, MessageAttachment } from "./types";

/** Flattens a message's `content` to plain text. */
export function contentToText(content: Message["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === "string" ? item : item.text || JSON.stringify(item)
      )
      .join("");
  }
  return JSON.stringify(content);
}

/**
 * Returns the part of a message the user should see.
 *
 * Model-only content (MCP `annotations.audience` without `"user"`) stays in
 * `message.content` / `message.attachments` for the model but is left out here.
 */
export function getVisibleMessageContent(message: Message): {
  text: string;
  attachments: MessageAttachment[];
} {
  return {
    text: message.displayContent ?? contentToText(message.content),
    attachments: (message.attachments ?? []).filter(
      (attachment) => !attachment.modelOnly
    ),
  };
}

/** Whether a user message has nothing to show (all of it is model-only). */
export function isHiddenFromUser(message: Message): boolean {
  const { text, attachments } = getVisibleMessageContent(message);
  return text.trim().length === 0 && attachments.length === 0;
}
