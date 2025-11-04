/**
 * AI SDK Integration Utilities
 *
 * Utility functions for integrating MCPAgent's streamEvents with Vercel AI SDK.
 * These utilities help convert stream events to AI SDK compatible formats.
 */

import type { StreamEvent } from "@langchain/core/tracers/log_stream";

/**
 * Converts streamEvents to AI SDK compatible stream (basic version)
 * Only yields the actual content tokens from chat model streams
 */
export async function* streamEventsToAISDK(
  streamEvents: AsyncGenerator<StreamEvent, void, void>
): AsyncGenerator<string, void, void> {
  for await (const event of streamEvents) {
    if (event.event === "on_chat_model_stream" && event.data?.chunk?.text) {
      const textContent = event.data.chunk.text;
      if (typeof textContent === "string" && textContent.length > 0) {
        yield textContent;
      }
    }
  }
}

/**
 * Converts async generator to ReadableStream for AI SDK compatibility
 */
export function createReadableStreamFromGenerator(
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

/**
 * Enhanced adapter that includes tool information along with chat content
 * Yields both content tokens and tool usage notifications
 */
export async function* streamEventsToAISDKWithTools(
  streamEvents: AsyncGenerator<StreamEvent, void, void>
): AsyncGenerator<string, void, void> {
  for await (const event of streamEvents) {
    switch (event.event) {
      case "on_chat_model_stream":
        if (event.data?.chunk?.text) {
          const textContent = event.data.chunk.text;
          if (typeof textContent === "string" && textContent.length > 0) {
            yield textContent;
          }
        }
        break;

      case "on_tool_start":
        yield `\n🔧 Using tool: ${event.name}\n`;
        break;

      case "on_tool_end":
        yield `\n✅ Tool completed: ${event.name}\n`;
        break;
      default:
        break;
    }
  }
}
