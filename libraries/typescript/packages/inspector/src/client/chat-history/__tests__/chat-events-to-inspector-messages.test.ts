import { describe, expect, it } from "vitest";
import { chatEventsToInspectorMessages } from "../chat-events-to-inspector-messages";

describe("chatEventsToInspectorMessages", () => {
  it("returns empty array for no events", () => {
    expect(chatEventsToInspectorMessages([])).toEqual([]);
  });

  it("converts user and assistant messages", () => {
    const messages = chatEventsToInspectorMessages([
      {
        id: "u1",
        type: "user_message",
        eventData: { content: { text: "Hello" } },
        createdAt: "2026-01-01T10:00:00.000Z",
      },
      {
        id: "a1",
        type: "assistant_message",
        eventData: { content: { text: "Hi there" } },
        createdAt: "2026-01-01T10:00:01.000Z",
      },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "Hello" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "Hi there",
    });
  });

  it("pairs tool calls with tool results", () => {
    const messages = chatEventsToInspectorMessages([
      {
        id: "tc1",
        type: "tool_call",
        eventData: {
          content: {
            toolCallId: "call-1",
            toolName: "search",
            args: { q: "mcp" },
          },
        },
        createdAt: "2026-01-01T10:00:02.000Z",
      },
      {
        id: "tr1",
        type: "tool_result",
        eventData: {
          content: {
            toolCallId: "call-1",
            result: { ok: true },
          },
        },
        createdAt: "2026-01-01T10:00:03.000Z",
      },
      {
        id: "a2",
        type: "assistant_message",
        eventData: { content: { text: "Done" } },
        createdAt: "2026-01-01T10:00:04.000Z",
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    const part = messages[0]?.parts?.[0];
    expect(part?.type).toBe("tool-invocation");
    if (part?.type === "tool-invocation" && part.toolInvocation) {
      expect(part.toolInvocation.state).toBe("result");
      expect(part.toolInvocation.result).toEqual({ ok: true });
    }
  });
});
