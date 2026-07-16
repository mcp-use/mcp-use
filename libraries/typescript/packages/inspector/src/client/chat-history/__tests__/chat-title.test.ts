import { describe, expect, it } from "vitest";
import {
  firstUserMessageFromMessages,
  generateChatTitleWithLlm,
} from "../chat-title";

describe("chat-title", () => {
  it("extracts first user message text", () => {
    expect(
      firstUserMessageFromMessages([
        {
          id: "1",
          role: "assistant",
          content: "hi",
          timestamp: 1,
        },
        {
          id: "2",
          role: "user",
          content: "List MCP tools",
          timestamp: 2,
        },
      ])
    ).toBe("List MCP tools");
  });

  it("uses greeting text for greeting-only messages without calling LLM", async () => {
    const title = await generateChatTitleWithLlm(
      {
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-4o-mini",
      },
      "Hello!"
    );
    expect(title).toBe("Hello!");
  });

  it("returns null when llm config is missing credentials", async () => {
    const title = await generateChatTitleWithLlm(
      {
        provider: "openai",
        apiKey: "",
        model: "gpt-4o-mini",
      },
      "How do I deploy?"
    );
    expect(title).toBeNull();
  });
});
