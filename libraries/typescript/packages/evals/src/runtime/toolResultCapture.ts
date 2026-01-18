import type { BaseMessage } from "mcp-use";
import type { ToolCall, ToolCallError, ToolCallOutput } from "./types.js";

/**
 * Check if a LangChain message is a tool message (tool result).
 *
 * @param message - LangChain BaseMessage to check
 * @returns True if the message contains tool output/error
 * @internal
 */
function isToolMessage(message: BaseMessage): boolean {
  const msg = message as BaseMessage & {
    type?: string;
    tool_call_id?: string;
    _getType?: () => string;
  };
  if (typeof msg._getType === "function") {
    return msg._getType() === "tool";
  }
  return msg.type === "tool" || typeof msg.tool_call_id === "string";
}

/**
 * Normalize tool output to standardized format (text or JSON).
 *
 * @param value - Raw output value
 * @returns Normalized ToolCallOutput
 * @internal
 */
function normalizeOutput(value: unknown): ToolCallOutput {
  if (typeof value === "string") {
    return { kind: "text", value };
  }
  return { kind: "json", value };
}

/**
 * Normalize tool error to standardized format (text or JSON).
 *
 * @param value - Raw error value
 * @returns Normalized ToolCallError
 * @internal
 */
function normalizeError(value: unknown): ToolCallError {
  if (typeof value === "string") {
    return { kind: "text", value };
  }
  return { kind: "json", value };
}

/**
 * Extract tool output or error from message content.
 * Handles various formats: plain text, JSON strings, objects with error fields.
 *
 * @param content - Message content to parse
 * @returns Object with either output or error field
 * @internal
 */
function extractToolPayload(content: unknown): {
  output?: ToolCallOutput;
  error?: ToolCallError;
} {
  if (typeof content === "string") {
    const trimmed = content.trim();
    // Only treat as error if it has explicit error prefix patterns
    if (/^error[:\s-]/i.test(trimmed)) {
      return { error: normalizeError(trimmed) };
    }
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        return { error: normalizeError((parsed as { error: unknown }).error) };
      }
      return { output: normalizeOutput(parsed) };
    } catch {
      return { output: normalizeOutput(content) };
    }
  }

  if (content && typeof content === "object" && "error" in content) {
    return { error: normalizeError((content as { error: unknown }).error) };
  }

  return { output: normalizeOutput(content) };
}

/**
 * Attach tool results from conversation history to tool call records.
 * Matches tool messages to tool calls by ID when available, or by order as fallback.
 *
 * @param toolCalls - Array of ToolCall records to populate with results
 * @param messages - Conversation history containing tool messages
 * @internal
 */
export function attachToolResults(
  toolCalls: ToolCall[],
  messages: BaseMessage[]
): void {
  const toolMessages = messages.filter(isToolMessage);
  let cursor = 0;

  for (const message of toolMessages) {
    const messageToolCallId = (message as { tool_call_id?: string })
      .tool_call_id;

    let toolCall: ToolCall | undefined;

    // Try to match by tool_call_id if available
    if (messageToolCallId) {
      toolCall = toolCalls.find((tc) => tc.tool_call_id === messageToolCallId);
    }

    // Fallback to cursor-based matching if no ID match
    if (!toolCall) {
      toolCall = toolCalls[cursor];
    }

    if (!toolCall) break;

    const payload = extractToolPayload(
      (message as { content?: unknown }).content
    );
    toolCall.output = payload.output;
    toolCall.error = payload.error;
    toolCall.durationMs = Math.max(0, Date.now() - toolCall.startedAt);

    // Only increment cursor if we used cursor-based matching
    if (
      !messageToolCallId ||
      !toolCalls.find((tc) => tc.tool_call_id === messageToolCallId)
    ) {
      cursor += 1;
    }
  }
}
