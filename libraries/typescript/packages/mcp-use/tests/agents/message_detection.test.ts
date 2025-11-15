/**
 * Unit tests for message detection helper methods in MCPAgent
 * Tests the robustness of handling different message formats (issue #446)
 */

import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import { beforeEach, describe, expect, it } from "vitest";
import { MCPAgent } from "../../src/agents/mcp_agent.js";

describe("MCPAgent Message Detection Methods", () => {
  let agent: MCPAgent;

  beforeEach(() => {
    // Create a minimal agent for testing private methods
    // We'll access private methods via bracket notation
    const mockLLM: any = {
      stream: async function* () {
        yield { type: "ai", content: "test" };
      },
    };

    const mockConnector: any = {
      publicIdentifier: "test",
      isClientConnected: false,
      connect: async () => {},
      disconnect: async () => {},
      listTools: async () => [],
      callTool: async () => ({}),
    };

    agent = new MCPAgent({
      llm: mockLLM,
      connectors: [mockConnector],
      maxSteps: 1,
    });
  });

  describe("_isAIMessageLike", () => {
    it("should detect real AIMessage instances", () => {
      const message = new AIMessage("Hello");
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should detect plain objects with type='ai'", () => {
      const message = { type: "ai", content: "Hello" };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should detect plain objects with type='assistant'", () => {
      const message = { type: "assistant", content: "Hello" };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should detect objects with role='ai'", () => {
      const message = { role: "ai", content: "Hello" };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should detect objects with role='assistant'", () => {
      const message = { role: "assistant", content: "Hello" };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should detect objects with getType() method returning 'ai'", () => {
      const message = {
        getType: () => "ai",
        content: "Hello",
      };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should detect objects with getType() method returning 'assistant'", () => {
      const message = {
        getType: () => "assistant",
        content: "Hello",
      };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should detect objects with _getType() method", () => {
      const message = {
        _getType: () => "ai",
        content: "Hello",
      };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should handle getType() throwing errors gracefully", () => {
      const message = {
        getType: () => {
          throw new Error("Method error");
        },
        type: "ai",
        content: "Hello",
      };
      // Should fall through to type check
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should accept AI messages without content (tool_calls only)", () => {
      const message = {
        type: "ai",
        tool_calls: [{ name: "add", args: {} }],
      };
      expect((agent as any)._isAIMessageLike(message)).toBe(true);
    });

    it("should reject null", () => {
      expect((agent as any)._isAIMessageLike(null)).toBe(false);
    });

    it("should reject undefined", () => {
      expect((agent as any)._isAIMessageLike(undefined)).toBe(false);
    });

    it("should reject non-AI message types", () => {
      const message = { type: "human", content: "Hello" };
      expect((agent as any)._isAIMessageLike(message)).toBe(false);
    });

    it("should reject plain strings", () => {
      expect((agent as any)._isAIMessageLike("hello")).toBe(false);
    });

    it("should reject numbers", () => {
      expect((agent as any)._isAIMessageLike(42)).toBe(false);
    });

    it("should reject objects without type/role indicators", () => {
      const message = { content: "Hello" };
      expect((agent as any)._isAIMessageLike(message)).toBe(false);
    });
  });

  describe("_isHumanMessageLike", () => {
    it("should detect real HumanMessage instances", () => {
      const message = new HumanMessage("Hello");
      expect((agent as any)._isHumanMessageLike(message)).toBe(true);
    });

    it("should detect plain objects with type='human'", () => {
      const message = { type: "human", content: "Hello" };
      expect((agent as any)._isHumanMessageLike(message)).toBe(true);
    });

    it("should detect objects with type='user'", () => {
      const message = { type: "user", content: "Hello" };
      expect((agent as any)._isHumanMessageLike(message)).toBe(true);
    });

    it("should detect objects with role='human'", () => {
      const message = { role: "human", content: "Hello" };
      expect((agent as any)._isHumanMessageLike(message)).toBe(true);
    });

    it("should detect objects with role='user'", () => {
      const message = { role: "user", content: "Hello" };
      expect((agent as any)._isHumanMessageLike(message)).toBe(true);
    });

    it("should detect objects with getType() method", () => {
      const message = {
        getType: () => "human",
        content: "Hello",
      };
      expect((agent as any)._isHumanMessageLike(message)).toBe(true);
    });

    it("should reject AI messages", () => {
      const message = { type: "ai", content: "Hello" };
      expect((agent as any)._isHumanMessageLike(message)).toBe(false);
    });

    it("should reject null", () => {
      expect((agent as any)._isHumanMessageLike(null)).toBe(false);
    });
  });

  describe("_isToolMessageLike", () => {
    it("should detect real ToolMessage instances", () => {
      const message = new ToolMessage({
        content: "result",
        tool_call_id: "123",
      });
      expect((agent as any)._isToolMessageLike(message)).toBe(true);
    });

    it("should detect plain objects with type='tool'", () => {
      const message = { type: "tool", content: "result" };
      expect((agent as any)._isToolMessageLike(message)).toBe(true);
    });

    it("should detect objects with getType() method", () => {
      const message = {
        getType: () => "tool",
        content: "result",
      };
      expect((agent as any)._isToolMessageLike(message)).toBe(true);
    });

    it("should reject non-tool messages", () => {
      const message = { type: "ai", content: "Hello" };
      expect((agent as any)._isToolMessageLike(message)).toBe(false);
    });

    it("should reject null", () => {
      expect((agent as any)._isToolMessageLike(null)).toBe(false);
    });
  });

  describe("_messageHasToolCalls", () => {
    it("should detect messages with tool_calls array", () => {
      const message = {
        type: "ai",
        content: "",
        tool_calls: [{ name: "add", args: { a: 1, b: 2 } }],
      };
      expect((agent as any)._messageHasToolCalls(message)).toBe(true);
    });

    it("should detect AIMessage with tool_calls", () => {
      const message = new AIMessage({
        content: "",
        tool_calls: [{ name: "add", args: { a: 1, b: 2 } }] as any,
      });
      expect((agent as any)._messageHasToolCalls(message)).toBe(true);
    });

    it("should return false for empty tool_calls array", () => {
      const message = {
        type: "ai",
        content: "Hello",
        tool_calls: [],
      };
      expect((agent as any)._messageHasToolCalls(message)).toBe(false);
    });

    it("should return false for messages without tool_calls", () => {
      const message = {
        type: "ai",
        content: "Hello",
      };
      expect((agent as any)._messageHasToolCalls(message)).toBe(false);
    });

    it("should return false for null", () => {
      expect((agent as any)._messageHasToolCalls(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect((agent as any)._messageHasToolCalls(undefined)).toBe(false);
    });

    it("should return false when tool_calls is not an array", () => {
      const message = {
        type: "ai",
        content: "Hello",
        tool_calls: "not an array",
      };
      expect((agent as any)._messageHasToolCalls(message)).toBe(false);
    });
  });

  describe("_getMessageContent", () => {
    it("should extract content from AIMessage", () => {
      const message = new AIMessage("Hello world");
      expect((agent as any)._getMessageContent(message)).toBe("Hello world");
    });

    it("should extract content from plain object", () => {
      const message = { type: "ai", content: "Hello world" };
      expect((agent as any)._getMessageContent(message)).toBe("Hello world");
    });

    it("should handle messages with undefined content", () => {
      const message = { type: "ai", content: undefined };
      expect((agent as any)._getMessageContent(message)).toBe(undefined);
    });

    it("should handle messages with null content", () => {
      const message = { type: "ai", content: null };
      expect((agent as any)._getMessageContent(message)).toBe(null);
    });

    it("should return undefined for messages without content", () => {
      const message = { type: "ai" };
      expect((agent as any)._getMessageContent(message)).toBe(undefined);
    });

    it("should return undefined for null", () => {
      expect((agent as any)._getMessageContent(null)).toBe(undefined);
    });

    it("should return undefined for undefined", () => {
      expect((agent as any)._getMessageContent(undefined)).toBe(undefined);
    });

    it("should extract complex content", () => {
      const complexContent = [
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ];
      const message = { type: "ai", content: complexContent };
      expect((agent as any)._getMessageContent(message)).toEqual(complexContent);
    });
  });

  describe("Integration: Message format compatibility", () => {
    it("should handle messages from different LangChain versions", () => {
      // Simulating different message formats that might appear
      const formats = [
        new AIMessage("test"), // Real instance
        { type: "ai", content: "test" }, // Plain object
        { role: "assistant", content: "test" }, // OpenAI format
        {
          // Partially deserialized
          getType: () => "ai",
          content: "test",
        },
      ];

      formats.forEach((format) => {
        expect((agent as any)._isAIMessageLike(format)).toBe(true);
      });
    });

    it("should correctly identify final AI messages (without tool calls)", () => {
      const finalMessage = { type: "ai", content: "Final answer" };
      const toolCallMessage = {
        type: "ai",
        content: "",
        tool_calls: [{ name: "add", args: {} }],
      };

      expect(
        (agent as any)._isAIMessageLike(finalMessage) &&
          !(agent as any)._messageHasToolCalls(finalMessage)
      ).toBe(true);

      expect(
        (agent as any)._isAIMessageLike(toolCallMessage) &&
          !(agent as any)._messageHasToolCalls(toolCallMessage)
      ).toBe(false);
    });
  });
});

