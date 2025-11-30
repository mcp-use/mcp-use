/**
 * Tests for AI SDK compatibility with MCPAgent streamEvents()
 *
 * These tests verify that streamEvents() can be used with the AI SDK's
 * createTextStreamResponse for creating data stream responses compatible with
 * Vercel AI SDK hooks like useCompletion and useChat.
 */

import type { StreamEvent } from "../index.js";
import { createTextStreamResponse } from "ai";
import { describe, expect, it } from "vitest";

// Mock an async generator that simulates our streamEvents output
async function* mockStreamEvents(): AsyncGenerator<StreamEvent, void, void> {
  // Simulate typical events from streamEvents
  yield {
    event: "on_chain_start",
    name: "AgentExecutor",
    data: { input: { input: "test query" } },
  } as StreamEvent;

  yield {
    event: "on_chat_model_stream",
    name: "ChatAnthropic",
    data: { chunk: { content: "Hello" } },
  } as StreamEvent;

  yield {
    event: "on_chat_model_stream",
    name: "ChatAnthropic",
    data: { chunk: { content: " world" } },
  } as StreamEvent;

  yield {
    event: "on_chat_model_stream",
    name: "ChatAnthropic",
    data: { chunk: { content: "!" } },
  } as StreamEvent;

  yield {
    event: "on_tool_start",
    name: "test_tool",
    data: { input: { query: "test" } },
  } as StreamEvent;

  yield {
    event: "on_tool_end",
    name: "test_tool",
    data: { output: "Tool executed successfully" },
  } as StreamEvent;

  yield {
    event: "on_chain_end",
    name: "AgentExecutor",
    data: { output: "Hello world!" },
  } as StreamEvent;
}

// Function to convert streamEvents to a format compatible with AI SDK
async function* streamEventsToAISDK(
  streamEvents: AsyncGenerator<StreamEvent, void, void>
): AsyncGenerator<string, void, void> {
  for await (const event of streamEvents) {
    // Only yield the actual content tokens from chat model streams
    if (event.event === "on_chat_model_stream" && event.data?.chunk?.content) {
      yield event.data.chunk.content;
    }
  }
}

// Alternative adapter that yields complete content at the end
async function* streamEventsToCompleteContent(
  streamEvents: AsyncGenerator<StreamEvent, void, void>
): AsyncGenerator<string, void, void> {
  let fullContent = "";

  for await (const event of streamEvents) {
    if (event.event === "on_chat_model_stream" && event.data?.chunk?.content) {
      fullContent += event.data.chunk.content;
    }
    // For tool events, we could add additional formatting
    else if (event.event === "on_tool_start") {
      // Could add tool start indicators if needed
    } else if (event.event === "on_tool_end") {
      // Could add tool completion indicators if needed
    }
  }

  // Yield the complete content at the end
  if (fullContent) {
    yield fullContent;
  }
}

describe("aI SDK Compatibility", () => {
  it("should convert streamEvents to AI SDK compatible stream", async () => {
    const mockEvents = mockStreamEvents();
    const aiSDKStream = streamEventsToAISDK(mockEvents);

    const tokens: string[] = [];
    for await (const token of aiSDKStream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["Hello", " world", "!"]);
  });

  it("should work with createTextStreamResponse from AI SDK v5", async () => {
    const mockEvents = mockStreamEvents();
    const aiSDKStream = streamEventsToAISDK(mockEvents);

    // Convert async generator to ReadableStream for AI SDK compatibility
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of aiSDKStream) {
            controller.enqueue(token);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    // Test that we can create a text stream response
    const response = createTextStreamResponse({ textStream: readableStream });

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );

    // Actually consume and validate the stream to ensure data flows correctly
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    // Verify the content made it through the AI SDK transformation
    expect(fullText).toContain("Hello");
    expect(fullText).toContain(" world");
    expect(fullText).toContain("!");
  });

  it("should convert streamEvents to complete content stream", async () => {
    const mockEvents = mockStreamEvents();
    const contentStream = streamEventsToCompleteContent(mockEvents);

    const content: string[] = [];
    for await (const chunk of contentStream) {
      content.push(chunk);
    }

    expect(content).toEqual(["Hello world!"]);
  });

  it("should handle empty streams gracefully", async () => {
    async function* emptyStreamEvents(): AsyncGenerator<
      StreamEvent,
      void,
      void
    > {
      // Empty generator
    }

    const emptyEvents = emptyStreamEvents();
    const aiSDKStream = streamEventsToAISDK(emptyEvents);

    const tokens: string[] = [];
    for await (const token of aiSDKStream) {
      tokens.push(token);
    }

    expect(tokens).toEqual([]);
  });

  it("should filter non-content events correctly", async () => {
    async function* mixedEvents(): AsyncGenerator<StreamEvent, void, void> {
      yield {
        event: "on_chain_start",
        name: "Test",
        data: { input: "test" },
      } as StreamEvent;

      yield {
        event: "on_chat_model_stream",
        name: "ChatModel",
        data: { chunk: { content: "Content" } },
      } as StreamEvent;

      yield {
        event: "on_tool_start",
        name: "Tool",
        data: { input: "test" },
      } as StreamEvent;

      yield {
        event: "on_chat_model_stream",
        name: "ChatModel",
        data: { chunk: { content: " token" } },
      } as StreamEvent;

      yield {
        event: "on_chain_end",
        name: "Test",
        data: { output: "result" },
      } as StreamEvent;
    }

    const events = mixedEvents();
    const aiSDKStream = streamEventsToAISDK(events);

    const tokens: string[] = [];
    for await (const token of aiSDKStream) {
      tokens.push(token);
    }

    expect(tokens).toEqual(["Content", " token"]);
  });

  it("should create readable stream from streamEvents", async () => {
    const mockEvents = mockStreamEvents();

    // Create a ReadableStream from our async generator
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of streamEventsToAISDK(mockEvents)) {
            controller.enqueue(new TextEncoder().encode(event));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    expect(readableStream).toBeInstanceOf(ReadableStream);

    // Test that we can read from the stream
    const reader = readableStream.getReader();
    const decoder = new TextDecoder();

    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    expect(chunks).toEqual(["Hello", " world", "!"]);
  });

  it("should maintain data integrity through AI SDK transformation", async () => {
    const mockEvents = mockStreamEvents();
    const aiSDKStream = streamEventsToAISDK(mockEvents);

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of aiSDKStream) {
            controller.enqueue(token);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const response = createTextStreamResponse({ textStream: readableStream });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Collect all chunks to verify order and completeness
    const chunks: string[] = [];
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      chunks.push(chunk);
      fullText += chunk;
    }

    // Verify data order is maintained
    expect(chunks.length).toBeGreaterThan(0);

    // Verify complete content is present
    expect(fullText).toBe("Hello world!");

    // Verify no data corruption
    expect(fullText).not.toContain("undefined");
    expect(fullText).not.toContain("null");
  });

  it("should handle stream errors gracefully", async () => {
    async function* errorStreamEvents(): AsyncGenerator<
      StreamEvent,
      void,
      void
    > {
      yield {
        event: "on_chat_model_stream",
        name: "ChatModel",
        data: { chunk: { content: "Start" } },
      } as StreamEvent;

      // Simulate an error mid-stream
      throw new Error("Stream error");
    }

    const aiSDKStream = streamEventsToAISDK(errorStreamEvents());

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of aiSDKStream) {
            controller.enqueue(token);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const response = createTextStreamResponse({ textStream: readableStream });
    const reader = response.body!.getReader();

    // Should get partial data before error
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe("Start");

    // Should propagate the error
    await expect(reader.read()).rejects.toThrow();
  });

  it("should support incremental consumption pattern used by useCompletion", async () => {
    const mockEvents = mockStreamEvents();
    const aiSDKStream = streamEventsToAISDK(mockEvents);

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of aiSDKStream) {
            controller.enqueue(token);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const response = createTextStreamResponse({ textStream: readableStream });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Simulate how useCompletion consumes incrementally
    const receivedChunks: string[] = [];
    let accumulatedText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      receivedChunks.push(chunk);
      accumulatedText += chunk;

      // Verify each chunk is immediately available (no buffering delays)
      expect(chunk.length).toBeGreaterThan(0);
    }

    // Verify incremental updates were provided
    expect(receivedChunks.length).toBeGreaterThan(0);

    // Verify final accumulated text is correct
    expect(accumulatedText).toBe("Hello world!");
  });

  // Optional integration test with real LLM
  it.skipIf(!process.env.OPENAI_API_KEY)(
    "should work end-to-end with real MCPAgent and OpenAI",
    async () => {
      // Dynamic imports to avoid loading dependencies if test is skipped
      const { MCPAgent, MCPClient } = await import("../index.js");
      const { ChatOpenAI } = await import("@langchain/openai");

      // Create a minimal MCP setup for testing
      const client = new MCPClient({
        mcpServers: {
          // Use a simple echo server or no server for basic LLM testing
        },
      });

      const llm = new ChatOpenAI({
        model: "gpt-4o-mini",
        temperature: 0,
        streaming: true,
      });

      const agent = new MCPAgent({
        llm,
        client,
        maxSteps: 5, // Allows recursionLimit of 15 (5 * 3)
        verbose: false,
      });

      try {
        // Simple query that doesn't require tools
        const streamEvents = agent.streamEvents(
          "Say 'Hello from OpenAI' and nothing else"
        );

        // Convert to AI SDK format
        const aiSDKStream = streamEventsToAISDK(streamEvents);
        const readableStream = new ReadableStream({
          async start(controller) {
            try {
              for await (const token of aiSDKStream) {
                controller.enqueue(token);
              }
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        });

        // Create AI SDK response
        const response = createTextStreamResponse({
          textStream: readableStream,
        });

        expect(response).toBeInstanceOf(Response);
        expect(response.headers.get("Content-Type")).toBe(
          "text/plain; charset=utf-8"
        );

        // Consume the stream
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
        }

        // Verify we got a response from OpenAI
        expect(fullText.length).toBeGreaterThan(0);
        expect(fullText.toLowerCase()).toContain("hello");
      } finally {
        await agent.close();
        await client.closeAllSessions();
      }
    },
    30000 // 30 second timeout for real API call
  );
});

// Convert async generator to ReadableStream for AI SDK compatibility
function createReadableStreamFromGenerator(
  generator: AsyncGenerator<string, void, void>
): ReadableStream<string> {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

// Export the adapter functions for use in examples
export {
  createReadableStreamFromGenerator,
  streamEventsToAISDK,
  streamEventsToCompleteContent,
};
