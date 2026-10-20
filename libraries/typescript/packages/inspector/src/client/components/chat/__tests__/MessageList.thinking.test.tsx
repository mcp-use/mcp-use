import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MessageList } from "../MessageList";

// Keep the actual MessageList decision/rendering; isolate unrelated child UI.
vi.mock("../AssistantMessage", () => ({ AssistantMessage: () => null }));
vi.mock("../UserMessage", () => ({ UserMessage: () => null }));
vi.mock("../ToolCallDisplay", () => ({ ToolCallDisplay: () => null }));
vi.mock("../ToolResultRenderer", () => ({ ToolResultRenderer: () => null }));
vi.mock("@/client/components/ui/text-shimmer", () => ({
  TextShimmer: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

type Message = ComponentProps<typeof MessageList>["messages"][number];

function hasThinking(messages: Message[], isLoading = true) {
  return renderToStaticMarkup(
    <MessageList messages={messages} isLoading={isLoading} />
  ).includes("Thinking...");
}

function afterTool(
  state:
    | "pending"
    | "streaming"
    | "authorization-required"
    | "result"
    | "error",
  toolCallId = "call-1"
): Message {
  return {
    id: "assistant",
    role: "assistant",
    content: "",
    timestamp: 0,
    parts: [
      {
        type: "tool-invocation",
        toolInvocation: {
          toolCallId,
          toolName: "test_simple_text",
          args: { message: "hello" },
          state,
        },
      },
    ],
  };
}

describe("MessageList thinking indicator", () => {
  it("shows while waiting for the first model output", () => {
    expect(hasThinking([])).toBe(true);
  });

  it.each(["pending", "streaming", "authorization-required"] as const)(
    "does not compete with tool activity in state %s",
    (state) => {
      expect(hasThinking([afterTool(state)])).toBe(false);
    }
  );

  it.each(["result", "error"] as const)(
    "shows during the active model pause after a tool returns %s",
    (state) => {
      expect(hasThinking([afterTool(state)])).toBe(true);
    }
  );

  it.each(["pending", "streaming", "authorization-required"] as const)(
    "stays hidden when an earlier parallel tool is still %s",
    (state) => {
      const message = afterTool(state);
      message.parts!.push(...afterTool("result", "call-2").parts!);
      expect(hasThinking([message])).toBe(false);
    }
  );

  it("hides once text resumes after a tool result", () => {
    const message = afterTool("result");
    message.parts!.push({ type: "text", text: "Here is the answer" });
    expect(hasThinking([message])).toBe(false);
  });

  it("hides when the request is no longer active", () => {
    expect(hasThinking([], false)).toBe(false);
    expect(hasThinking([afterTool("result")], false)).toBe(false);
    expect(hasThinking([afterTool("error")], false)).toBe(false);
  });
});
