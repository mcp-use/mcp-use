import { convertMessagesToProvider as convertMessagesToProviderImpl } from "@/llm/messageFormat";
import type { ProviderMessage } from "@/llm/types";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import type { Message } from "./types";

/**
 * Converts inspector Message[] to provider-neutral ProviderMessage[] for use
 * as conversation history passed to the tool loop.
 *
 * Supports multimodal messages with image attachments and preserves tool
 * call / tool result context across conversation turns.
 */
export function convertMessagesToProvider(
  messages: Message[]
): ProviderMessage[] {
  return convertMessagesToProviderImpl(messages);
}

/**
 * Transforms MCP prompt results into chat UI Messages.
 *
 * @param results - MCP prompt results
 * @returns Inspector Messages
 */
export const convertPromptResultsToMessages = (
  results: PromptResult[]
): Message[] => {
  const messages: Message[] = [];
  for (const result of results) {
    // Handle error results
    if (result.error || result.result?.isError) {
      const errorMessage: Message = {
        id: `prompt-error-${result.promptName}-${result.timestamp}`,
        role: "assistant",
        content: result.error || "Prompt execution failed",
        timestamp: result.timestamp,
      };
      messages.push(errorMessage);
      continue;
    }

    // Handle success results - extract messages from GetPromptResult
    const promptResult = result.result;
    if (
      promptResult &&
      "messages" in promptResult &&
      Array.isArray(promptResult.messages)
    ) {
      for (const msg of promptResult.messages) {
        // Extract content and attachments based on type
        let content: string = "";
        const attachments: import("./types").MessageAttachment[] = [];

        if (typeof msg.content === "string") {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          const textParts: string[] = [];
          for (const item of msg.content) {
            if (item.type === "text" && item.text) {
              textParts.push(item.text);
            } else if (item.type === "image" && item.data) {
              attachments.push({
                type: "image",
                data: item.data,
                mimeType: item.mimeType || "image/png",
              });
            } else if (item.type === "resource") {
              textParts.push(`[Resource: ${item.resource?.uri || "embedded"}]`);
            }
          }
          content = textParts.join("\n");
        } else if (msg.content && typeof msg.content === "object") {
          if (msg.content.type === "text" && msg.content.text) {
            content = msg.content.text;
          } else if (msg.content.type === "image" && msg.content.data) {
            attachments.push({
              type: "image",
              data: msg.content.data,
              mimeType: msg.content.mimeType || "image/png",
            });
          } else {
            content = JSON.stringify(msg.content);
          }
        }

        if (!content && attachments.length === 0) {
          content = "[no content]";
        }

        const message: Message = {
          id: `prompt-${result.promptName}-${result.timestamp}-${messages.length}`,
          role: msg.role,
          content: content || "",
          timestamp: result.timestamp,
          attachments: attachments.length > 0 ? attachments : undefined,
        };
        messages.push(message);
      }
    }
  }
  return messages;
};
