import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MessageList } from "../MessageList";

vi.mock("../AssistantMessage", () => ({ AssistantMessage: () => null }));
vi.mock("../ToolCallDisplay", () => ({ ToolCallDisplay: () => null }));
vi.mock("../ToolResultRenderer", () => ({ ToolResultRenderer: () => null }));
vi.mock("@/client/components/ui/text-shimmer", () => ({
  TextShimmer: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

type Message = ComponentProps<typeof MessageList>["messages"][number];

function render(message: Message) {
  return renderToStaticMarkup(
    <MessageList messages={[message]} isLoading={false} />
  );
}

describe("MessageList user message visibility", () => {
  it("renders no row for a fully model-only message", () => {
    const html = render({
      id: "u1",
      role: "user",
      content: "Internal app instruction",
      displayContent: "",
      timestamp: 0,
    });
    expect(html).not.toContain("chat-message-user");
    expect(html).not.toContain("Internal app instruction");
  });

  it("renders only the visible text of a mixed message", () => {
    const html = render({
      id: "u1",
      role: "user",
      content: "Show me the summary.\nContext: page 3",
      displayContent: "Show me the summary.",
      timestamp: 0,
    });
    expect(html).toContain("Show me the summary.");
    expect(html).not.toContain("Context: page 3");
  });

  it("renders the full content when nothing is model-only", () => {
    const html = render({
      id: "u1",
      role: "user",
      content: "Plain follow-up",
      timestamp: 0,
    });
    expect(html).toContain("chat-message-user");
    expect(html).toContain("Plain follow-up");
  });
});
