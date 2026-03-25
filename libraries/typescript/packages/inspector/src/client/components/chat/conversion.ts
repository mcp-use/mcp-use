import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { PromptResult } from "../../hooks/useMCPPrompts";
import type { Message } from "./types";

function extractTextContent(m: Message): string {
  let raw =
    typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? (m.content as Array<{ text?: string }>)
            .map((x) => x?.text ?? "")
            .join("\n")
        : JSON.stringify(m.content ?? "");

  if (!raw.trim() && m.parts && m.parts.length > 0) {
    raw = m.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("");
  }

  return raw.trim();
}

/**
 * Strip `_meta` from a tool result before serializing for the model.
 * Keeps `structuredContent`, `content`, `isError`, and everything else.
 */
function serializeToolResult(result: unknown): string {
  if (result && typeof result === "object") {
    const { _meta, ...rest } = result as Record<string, unknown>;
    return JSON.stringify(rest);
  }
  return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * Converts inspector Message[] to LangChain BaseMessage[] for use as externalHistory
 * (e.g. in agent.streamEvents(..., externalHistory, ...)).
 *
 * Supports multimodal messages with image attachments and preserves tool
 * call / tool result context across conversation turns.
 *
 * @param messages - Inspector Messages
 * @returns LangChain BaseMessages
 */
export function convertMessagesToLangChain(messages: Message[]): BaseMessage[] {
  return messages.flatMap((m): BaseMessage[] => {
    // Handle user messages with attachments (multimodal)
    if (m.role === "user" && m.attachments && m.attachments.length > 0) {
      const textContent =
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? (m.content as Array<{ text?: string }>)
                .map((x) => x?.text ?? "")
                .join("\n")
            : JSON.stringify(m.content ?? "");

      const content: Array<any> = [
        {
          type: "text",
          text: textContent.trim() || "[no content]",
        },
      ];

      for (const attachment of m.attachments) {
        if (attachment.type === "image") {
          content.push({
            type: "image_url",
            image_url: {
              url: `data:${attachment.mimeType};base64,${attachment.data}`,
            },
          });
        }
      }

      return [new HumanMessage({ content })];
    }

    // Handle user messages (text only)
    if (m.role === "user") {
      const content = extractTextContent(m) || "[no content]";
      return [new HumanMessage(content)];
    }

    // --- Assistant messages ---

    const toolParts = (m.parts ?? []).filter(
      (p) =>
        p.type === "tool-invocation" &&
        p.toolInvocation &&
        p.toolInvocation.result !== undefined
    );

    // No tool invocations — plain assistant text
    if (toolParts.length === 0) {
      const content = extractTextContent(m) || "[no content]";
      return [new AIMessage(content)];
    }

    // Reconstruct AIMessage with tool_calls + ToolMessages for each result.
    const textContent = extractTextContent(m);
    const toolCalls = toolParts.map((p, i) => ({
      name: p.toolInvocation!.toolName,
      args: p.toolInvocation!.args,
      id: `call_${p.toolInvocation!.toolName}_${i}`,
    }));

    const aiMsg = new AIMessage({
      content: textContent || "",
      tool_calls: toolCalls,
    });

    const toolMessages = toolParts.map(
      (p, i) =>
        new ToolMessage({
          content: serializeToolResult(p.toolInvocation!.result),
          tool_call_id: `call_${p.toolInvocation!.toolName}_${i}`,
        })
    );

    return [aiMsg, ...toolMessages];
  });
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
          // Plain string content
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Array of content items (from mix())
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
              // Handle embedded resources - could show as link or expand later
              textParts.push(`[Resource: ${item.resource?.uri || "embedded"}]`);
            }
          }
          content = textParts.join("\n");
        } else if (msg.content && typeof msg.content === "object") {
          // Single content object
          if (msg.content.type === "text" && msg.content.text) {
            content = msg.content.text;
          } else if (msg.content.type === "image" && msg.content.data) {
            // Handle image content - convert to attachment
            attachments.push({
              type: "image",
              data: msg.content.data,
              mimeType: msg.content.mimeType || "image/png",
            });
          } else {
            // For other non-text content types, stringify it
            content = JSON.stringify(msg.content);
          }
        }

        // Only show "[no content]" if there's no text AND no attachments
        if (!content && attachments.length === 0) {
          content = "[no content]";
        }

        const message: Message = {
          id: `prompt-${result.promptName}-${result.timestamp}-${messages.length}`,
          role: msg.role,
          content: content || "", // Empty string if only attachments
          timestamp: result.timestamp,
          attachments: attachments.length > 0 ? attachments : undefined,
        };
        messages.push(message);
      }
    }
  }
  return messages;
};
