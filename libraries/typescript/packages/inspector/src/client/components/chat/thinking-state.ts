import type { Message } from "./types";

/**
 * Returns true when the assistant request is active but no visible text or
 * tool output is currently rendering -- i.e. the model is "thinking."
 *
 * This covers two gaps:
 *  1. Before the first text or tool call in a turn arrives.
 *  2. Between tool calls: a tool result has landed but the next text or
 *     tool call has not started yet.
 */
export function deriveIsThinking(
  isLoading: boolean,
  messages: Pick<Message, "role" | "content" | "parts">[]
): boolean {
  if (!isLoading) return false;
  if (messages.length === 0) return true;

  const last = messages[messages.length - 1];

  if (last.role === "user") return true;

  if (last.role === "assistant") {
    if (last.parts && last.parts.length > 0) {
      // If the last part is a completed tool result the model is about to
      // generate the next text or invoke another tool -- still "thinking."
      const lastPart = last.parts[last.parts.length - 1];
      return (
        lastPart?.type === "tool-invocation" &&
        (lastPart.toolInvocation?.state === "result" ||
          lastPart.toolInvocation?.state === "error")
      );
    }

    const contentStr =
      typeof last.content === "string"
        ? last.content
        : Array.isArray(last.content)
          ? last.content
              .map((item) =>
                typeof item === "string"
                  ? item
                  : ((item as { text?: string }).text ?? JSON.stringify(item))
              )
              .join("")
          : JSON.stringify(last.content);

    return !contentStr || !contentStr.trim();
  }

  return false;
}
