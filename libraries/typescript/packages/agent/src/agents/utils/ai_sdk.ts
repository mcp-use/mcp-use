/**
 * AI SDK Integration Utilities
 *
 * Utility functions for integrating MCPAgent's streamEvents with Vercel AI SDK.
 * These utilities help convert stream events to AI SDK compatible formats.
 */

import type { StreamEvent } from "@langchain/core/tracers/log_stream";

/**
 * Converts LangChain model stream events to text chunks.
 *
 * @param streamEvents - Events returned by the LangChain agent's
 * `streamEvents` method.
 * @returns An async generator containing only model text chunks.
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
 * Wraps an async text generator in a web `ReadableStream`.
 *
 * @param generator - Async text generator to consume.
 * @returns A stream that enqueues each generated string and forwards errors.
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
 * Converts LangChain events to text and inserts tool lifecycle messages.
 *
 * @param streamEvents - Events returned by the LangChain agent's
 * `streamEvents` method.
 * @returns Model text interleaved with human-readable tool start/end messages.
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
