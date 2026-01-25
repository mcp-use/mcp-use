import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { Message } from "./types";
import type { PromptResult } from "../../hooks/useMCPPrompts";

/**
 * Converts inspector Message[] to LangChain BaseMessage[] for use as externalHistory
 * (e.g. in agent.streamEvents(..., externalHistory, ...)).
 *
 * @param messages - Inspector Messages
 * @returns LangChain BaseMessages
 */
export function convertMessagesToLangChain(
  messages: Message[]
): (HumanMessage | AIMessage)[] {
  return messages.map((m) => {
    const raw =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? (m.content as Array<{ text?: string }>)
              .map((x) => x?.text ?? "")
              .join("\n")
          : JSON.stringify(m.content ?? "");
    const content = raw.trim() || "[no content]";
    return m.role === "user"
      ? new HumanMessage(content)
      : new AIMessage(content);
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
        // Extract content based on type
        let content: string = "";
        if (typeof msg.content === "string") {
          // some llm apis require non-empty content
          content = msg.content;
        } else if (msg.content && typeof msg.content === "object") {
          // Handle structured content (text, image, audio, etc.)
          if (msg.content.type === "text" && msg.content.text) {
            content = msg.content.text;
          } else {
            // For non-text content, stringify it
            content = JSON.stringify(msg.content);
          }
        }

        content = content || "[no content]";

        const message: Message = {
          id: `prompt-${result.promptName}-${result.timestamp}-${messages.length}`,
          role: msg.role,
          content: content,
          timestamp: result.timestamp,
        };
        messages.push(message);
      }
    }
  }
  return messages;
};
