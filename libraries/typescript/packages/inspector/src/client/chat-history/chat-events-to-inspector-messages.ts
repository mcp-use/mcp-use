import type { Message as InspectorMessage } from "@/client/components/chat/types";

/** Shape of rows from GET /api/v1/chats/:id/events (OpenAPI). */
export type ChatEventRowForMessages = {
  id: string;
  type: string;
  eventData: unknown;
  createdAt: string | Date;
};

/**
 * Convert persisted chat events → inspector `Message[]` (same contract as the backend stream).
 */
export function chatEventsToInspectorMessages(
  events: ChatEventRowForMessages[]
): InspectorMessage[] {
  if (!events.length) return [];
  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const out: InspectorMessage[] = [];
  let assistantBuf: InspectorMessage | null = null;
  const toolCallPartIndex = new Map<string, number>();

  const flushAssistant = () => {
    if (!assistantBuf) return;
    const hasParts = (assistantBuf.parts?.length ?? 0) > 0;
    const hasText =
      typeof assistantBuf.content === "string" &&
      assistantBuf.content.trim() !== "";
    if (hasParts || hasText) {
      out.push(assistantBuf);
    }
    assistantBuf = null;
    toolCallPartIndex.clear();
  };

  for (const event of sorted) {
    const ts = new Date(event.createdAt).getTime();

    if (event.type === "user_message") {
      flushAssistant();
      const eventData = event.eventData as { content?: { text?: string } };
      const text = (eventData?.content?.text as string) || "";
      out.push({
        id: event.id,
        role: "user",
        content: text,
        timestamp: ts,
      });
      continue;
    }

    if (event.type === "tool_call") {
      const raw = event.eventData as {
        content?: { toolCallId?: string; toolName?: string; args?: unknown };
      };
      const tc = raw?.content ?? {};
      const toolCallId =
        typeof tc.toolCallId === "string" ? tc.toolCallId : event.id;
      if (!assistantBuf) {
        assistantBuf = {
          id: `assistant-${event.id}`,
          role: "assistant",
          content: "",
          timestamp: ts,
          parts: [],
        };
      }
      const idx = assistantBuf.parts!.length;
      assistantBuf.parts!.push({
        type: "tool-invocation",
        toolInvocation: {
          toolName: String(tc.toolName ?? "unknown"),
          args: (tc.args as Record<string, unknown>) ?? {},
          state: "pending",
        },
      });
      toolCallPartIndex.set(toolCallId, idx);
      continue;
    }

    if (event.type === "tool_result") {
      const raw = event.eventData as {
        content?: { toolCallId?: string; result?: unknown; status?: string };
      };
      const tr = raw?.content ?? {};
      const toolCallId =
        typeof tr.toolCallId === "string" ? tr.toolCallId : undefined;
      if (assistantBuf && toolCallId !== undefined && assistantBuf.parts) {
        const idx = toolCallPartIndex.get(toolCallId);
        if (idx !== undefined) {
          const part = assistantBuf.parts[idx];
          if (part?.type === "tool-invocation" && part.toolInvocation) {
            part.toolInvocation.result = tr.result;
            part.toolInvocation.state = "result";
          }
        }
      }
      continue;
    }

    if (event.type === "assistant_message") {
      const eventData = event.eventData as { content?: { text?: string } };
      const text = (eventData?.content?.text as string) || "";
      if (!assistantBuf) {
        out.push({
          id: event.id,
          role: "assistant",
          content: text,
          timestamp: ts,
          parts: text ? [{ type: "text", text }] : [],
        });
      } else {
        assistantBuf.id = event.id;
        assistantBuf.timestamp = ts;
        assistantBuf.content = text;
        if (text) {
          assistantBuf.parts = assistantBuf.parts ?? [];
          assistantBuf.parts.push({ type: "text", text });
        }
        flushAssistant();
      }
      continue;
    }
  }

  flushAssistant();
  return out;
}
