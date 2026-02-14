import type { AIMessage, BaseMessage } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Normalize message content to a string representation.
 * Handles various message formats including nested content structures.
 */
export function normalizeMessageContent(message: BaseMessage | unknown): string {
  try {
    if (typeof message === "string") {
      return message;
    }

    if (message && typeof message === "object" && "content" in message) {
      const content = (message as { content: unknown }).content;
      return normalizeMessageContent(content);
    }

    if (Array.isArray(message)) {
      const parts: string[] = [];
      for (const item of message) {
        if (typeof item === "object" && item !== null) {
          if ("text" in item && typeof item.text === "string") {
            parts.push(item.text);
          } else if ("content" in item) {
            parts.push(normalizeMessageContent(item.content));
          } else {
            parts.push(String(item));
          }
        } else {
          parts.push(String(item));
        }
      }
      return parts.join("");
    }

    return String(message);
  } catch {
    return String(message);
  }
}

/**
 * Extract tool calls from a message.
 * Returns an array of tool call objects with name, args, and optional id.
 */
export function extractToolCallsFromMessage(message: unknown): Array<{
  name: string;
  args: Record<string, unknown>;
  id?: string;
}> {
  if (
    typeof message === "object" &&
    message !== null &&
    "tool_calls" in message &&
    Array.isArray((message as { tool_calls?: unknown }).tool_calls)
  ) {
    const toolCalls = (message as { tool_calls: Array<{
      name?: string;
      args?: Record<string, unknown>;
      id?: string;
    }> }).tool_calls;
    
    return toolCalls
      .filter(tc => tc && typeof tc === "object")
      .map(tc => ({
        name: tc.name || "unknown",
        args: tc.args || {},
        id: tc.id,
      }));
  }
  
  return [];
}

/**
 * Detect if tools have been updated by comparing current tools with existing tools.
 */
export function detectToolUpdates(
  currentTools: StructuredToolInterface[],
  existingTools: StructuredToolInterface[]
): boolean {
  const currentToolNames = new Set(currentTools.map((t) => t.name));
  const existingToolNames = new Set(existingTools.map((t) => t.name));

  return currentToolNames.size !== existingToolNames.size ||
    [...currentToolNames].some((n) => !existingToolNames.has(n));
}


/**
 * Format tool input for logging purposes, truncating if necessary.
 */
export function formatToolInputForLogging(toolInput: unknown): string {
  const toolInputStr = JSON.stringify(toolInput);
  if (toolInputStr.length > 100) {
    return `${toolInputStr.slice(0, 97)}...`;
  }
  return toolInputStr;
}

/**
 * Format observation/result string for logging, truncating and normalizing newlines.
 */
export function formatObservationForLogging(observation: unknown): string {
  let observationStr = String(observation);
  if (observationStr.length > 100) {
    observationStr = `${observationStr.slice(0, 97)}...`;
  }
  return observationStr.replace(/\n/g, " ");
}

/**
 * Accumulate messages, avoiding duplicates based on reference equality.
 * Adds new messages to the accumulated array if they're not already present.
 */
export function accumulateMessages(
  messages: BaseMessage[],
  accumulatedMessages: BaseMessage[]
): void {
  for (const msg of messages) {
    if (!accumulatedMessages.includes(msg)) {
      accumulatedMessages.push(msg);
    }
  }
}