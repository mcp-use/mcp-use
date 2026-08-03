/**
 * Vercel AI SDK integration via LangChain streamEvents().
 *
 * Run: pnpm exec tsx examples/frameworks/ai_sdk_example.ts
 * Requires: ANTHROPIC_API_KEY
 */

import type { StreamEvent } from "@langchain/core/tracers/log_stream";
import { ChatAnthropic } from "@langchain/anthropic";
import { createTextStreamResponse } from "ai";
import { MCPAgent } from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";
import { ANTHROPIC_MODEL, simpleServerConfig } from "../_shared.js";

async function* streamEventsToAISDK(
  streamEvents: AsyncGenerator<StreamEvent, void, void>
): AsyncGenerator<string, void, void> {
  for await (const event of streamEvents) {
    if (event.event === "on_chat_model_stream") {
      const chunk = event.data?.chunk as
        | { text?: string; content?: string }
        | undefined;
      const text =
        typeof chunk?.text === "string"
          ? chunk.text
          : typeof chunk?.content === "string"
            ? chunk.content
            : "";
      if (text.length > 0) yield text;
    }
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const client = MCPClient.fromDict(simpleServerConfig());
  const agent = new MCPAgent({
    llm: new ChatAnthropic({
      model: ANTHROPIC_MODEL,
      temperature: 0,
      streaming: true,
    }),
    client,
    maxSteps: 5,
    autoInitialize: true,
  });

  try {
    const streamEvents = agent.streamEvents({
      prompt: "Say 'Hello from AI SDK' and nothing else.",
    });

    const readableStream = new ReadableStream<string>({
      async start(controller) {
        for await (const token of streamEventsToAISDK(streamEvents)) {
          controller.enqueue(token);
        }
        controller.close();
      },
    });

    const response = createTextStreamResponse({ textStream: readableStream });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    process.stdout.write("Stream: ");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      fullText += chunk;
      process.stdout.write(chunk);
    }
    console.log("\n\nFull text:", fullText);
  } finally {
    await agent.close();
  }
}

await main();
