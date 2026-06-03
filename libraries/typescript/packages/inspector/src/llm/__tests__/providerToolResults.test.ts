import { describe, expect, it } from "vitest";
import { toAnthropicMessages } from "../providers/anthropic";
import { toGeminiContents } from "../providers/google";
import { toOpenAIMessages } from "../providers/openai";
import { toolResultToContent } from "../toolResultParts";
import type { ProviderMessage } from "../types";

// The reference scenario for issue #1941: an assistant turn that called a
// tool, followed by a tool result containing an MCP image content block.
function buildImageToolMessages(): ProviderMessage[] {
  const result = {
    content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
  };
  return [
    { role: "user", content: "describe the image" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "fetch-image", args: {} }],
    },
    {
      role: "tool",
      toolCallId: "call_1",
      toolName: "fetch-image",
      toolResult: result,
      content: toolResultToContent(result),
    },
  ];
}

describe("Anthropic: tool_result content", () => {
  it("embeds an image block inside tool_result.content", () => {
    const out = toAnthropicMessages(buildImageToolMessages()) as any[];
    const userWithToolResult = out[out.length - 1];
    expect(userWithToolResult.role).toBe("user");
    const block = userWithToolResult.content[0];
    expect(block.type).toBe("tool_result");
    expect(block.tool_use_id).toBe("call_1");
    expect(Array.isArray(block.content)).toBe(true);
    const imageBlock = (block.content as any[]).find((b) => b.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.type).toBe("base64");
    expect(imageBlock.source.media_type).toBe("image/png");
    expect(imageBlock.source.data).toBe("AAAA");
  });

  it("keeps a plain-string tool_result.content for text-only results", () => {
    const messages: ProviderMessage[] = [
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "echo",
        toolResult: { content: [{ type: "text", text: "hello" }] },
        content: "hello",
      },
    ];
    const out = toAnthropicMessages(messages) as any[];
    const block = out[0].content[0];
    expect(block.type).toBe("tool_result");
    expect(block.content).toBe("hello");
  });
});

describe("OpenAI: tool message + follow-up user with image_url", () => {
  it("emits a tool message and a user message with image_url for the bytes", () => {
    const out = toOpenAIMessages(buildImageToolMessages()) as any[];
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(typeof toolMsg.content).toBe("string");
    expect(toolMsg.content).not.toContain("AAAA"); // base64 must NOT bleed in
    const trailingUser = out[out.length - 1];
    expect(trailingUser.role).toBe("user");
    const imgPart = trailingUser.content.find(
      (p: any) => p.type === "image_url"
    );
    expect(imgPart).toBeDefined();
    expect(imgPart.image_url.url).toBe("data:image/png;base64,AAAA");
  });

  it("does not inject a follow-up user message for text-only results", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "echo" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c", name: "echo", args: {} }],
      },
      {
        role: "tool",
        toolCallId: "c",
        toolName: "echo",
        toolResult: { content: [{ type: "text", text: "hi" }] },
        content: "hi",
      },
    ];
    const out = toOpenAIMessages(messages) as any[];
    expect(out.filter((m) => m.role === "user")).toHaveLength(1);
    const toolMsg = out.find((m) => m.role === "tool");
    expect(toolMsg.content).toBe("hi");
  });
});

describe("Google: functionResponse + follow-up user with inlineData", () => {
  it("keeps image bytes out of functionResponse.response and into a user inlineData part", () => {
    const out = toGeminiContents(buildImageToolMessages()) as any[];
    const fn = out.find((m) => m.role === "function");
    expect(fn).toBeDefined();
    const resp = fn.parts[0].functionResponse.response;
    expect(JSON.stringify(resp)).not.toContain("AAAA");
    expect(resp.images).toEqual([{ mimeType: "image/png", omitted: true }]);

    const trailingUser = out[out.length - 1];
    expect(trailingUser.role).toBe("user");
    const inline = trailingUser.parts.find((p: any) => p.inlineData);
    expect(inline.inlineData.mimeType).toBe("image/png");
    expect(inline.inlineData.data).toBe("AAAA");
  });

  it("preserves the text-only path with structured response", () => {
    const messages: ProviderMessage[] = [
      {
        role: "tool",
        toolCallId: "c",
        toolName: "echo",
        toolResult: { foo: "bar" },
        content: '{"foo":"bar"}',
      },
    ];
    const out = toGeminiContents(messages) as any[];
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("function");
    expect(out[0].parts[0].functionResponse.response).toEqual({ foo: "bar" });
  });
});
