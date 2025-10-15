/**
 * Tests for AI SDK compatibility with MCPAgent streamEvents()
 *
 * These tests verify that streamEvents() can be used with the AI SDK's
 * LangChainAdapter for creating data stream responses compatible with
 * Vercel AI SDK hooks like useCompletion and useChat.
 */

import type { StreamEvent } from '../index.js'
import { LangChainAdapter } from 'ai'
import { describe, expect, it } from 'vitest'

// Mock an async generator that simulates our streamEvents output
async function* mockStreamEvents(): AsyncGenerator<StreamEvent, void, void> {
  // Simulate typical events from streamEvents
  yield {
    event: 'on_chain_start',
    name: 'AgentExecutor',
    data: { input: { input: 'test query' } },
  } as StreamEvent

  yield {
    event: 'on_chat_model_stream',
    name: 'ChatAnthropic',
    data: { chunk: { content: 'Hello' } },
  } as StreamEvent

  yield {
    event: 'on_chat_model_stream',
    name: 'ChatAnthropic',
    data: { chunk: { content: ' world' } },
  } as StreamEvent

  yield {
    event: 'on_chat_model_stream',
    name: 'ChatAnthropic',
    data: { chunk: { content: '!' } },
  } as StreamEvent

  yield {
    event: 'on_tool_start',
    name: 'test_tool',
    data: { input: { query: 'test' } },
  } as StreamEvent

  yield {
    event: 'on_tool_end',
    name: 'test_tool',
    data: { output: 'Tool executed successfully' },
  } as StreamEvent

  yield {
    event: 'on_chain_end',
    name: 'AgentExecutor',
    data: { output: 'Hello world!' },
  } as StreamEvent
}

// Function to convert streamEvents to a format compatible with AI SDK
async function* streamEventsToAISDK(
  streamEvents: AsyncGenerator<StreamEvent, void, void>,
): AsyncGenerator<string, void, void> {
  for await (const event of streamEvents) {
    // Only yield the actual content tokens from chat model streams
    if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
      yield event.data.chunk.content
    }
  }
}

// Alternative adapter that yields complete content at the end
async function* streamEventsToCompleteContent(
  streamEvents: AsyncGenerator<StreamEvent, void, void>,
): AsyncGenerator<string, void, void> {
  let fullContent = ''

  for await (const event of streamEvents) {
    if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
      fullContent += event.data.chunk.content
    }
    // For tool events, we could add additional formatting
    else if (event.event === 'on_tool_start') {
      // Could add tool start indicators if needed
    }
    else if (event.event === 'on_tool_end') {
      // Could add tool completion indicators if needed
    }
  }

  // Yield the complete content at the end
  if (fullContent) {
    yield fullContent
  }
}

describe('aI SDK Compatibility', () => {
  it('should convert streamEvents to AI SDK compatible stream', async () => {
    const mockEvents = mockStreamEvents()
    const aiSDKStream = streamEventsToAISDK(mockEvents)

    const tokens: string[] = []
    for await (const token of aiSDKStream) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['Hello', ' world', '!'])
  })

  it('should work with LangChainAdapter.toDataStreamResponse', async () => {
    const mockEvents = mockStreamEvents()
    const aiSDKStream = streamEventsToAISDK(mockEvents)

    // Convert async generator to ReadableStream for AI SDK compatibility
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const token of aiSDKStream) {
            controller.enqueue(token)
          }
          controller.close()
        }
        catch (error) {
          controller.error(error)
        }
      },
    })

    // Test that we can create a data stream response
    const response = LangChainAdapter.toDataStreamResponse(readableStream)

    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
  })

  it('should convert streamEvents to complete content stream', async () => {
    const mockEvents = mockStreamEvents()
    const contentStream = streamEventsToCompleteContent(mockEvents)

    const content: string[] = []
    for await (const chunk of contentStream) {
      content.push(chunk)
    }

    expect(content).toEqual(['Hello world!'])
  })

  it('should handle empty streams gracefully', async () => {
    async function* emptyStreamEvents(): AsyncGenerator<StreamEvent, void, void> {
      // Empty generator

    }

    const emptyEvents = emptyStreamEvents()
    const aiSDKStream = streamEventsToAISDK(emptyEvents)

    const tokens: string[] = []
    for await (const token of aiSDKStream) {
      tokens.push(token)
    }

    expect(tokens).toEqual([])
  })

  it('should filter non-content events correctly', async () => {
    async function* mixedEvents(): AsyncGenerator<StreamEvent, void, void> {
      yield {
        event: 'on_chain_start',
        name: 'Test',
        data: { input: 'test' },
      } as StreamEvent

      yield {
        event: 'on_chat_model_stream',
        name: 'ChatModel',
        data: { chunk: { content: 'Content' } },
      } as StreamEvent

      yield {
        event: 'on_tool_start',
        name: 'Tool',
        data: { input: 'test' },
      } as StreamEvent

      yield {
        event: 'on_chat_model_stream',
        name: 'ChatModel',
        data: { chunk: { content: ' token' } },
      } as StreamEvent

      yield {
        event: 'on_chain_end',
        name: 'Test',
        data: { output: 'result' },
      } as StreamEvent
    }

    const events = mixedEvents()
    const aiSDKStream = streamEventsToAISDK(events)

    const tokens: string[] = []
    for await (const token of aiSDKStream) {
      tokens.push(token)
    }

    expect(tokens).toEqual(['Content', ' token'])
  })

  it('should create readable stream from streamEvents', async () => {
    const mockEvents = mockStreamEvents()

    // Create a ReadableStream from our async generator
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of streamEventsToAISDK(mockEvents)) {
            controller.enqueue(new TextEncoder().encode(event))
          }
          controller.close()
        }
        catch (error) {
          controller.error(error)
        }
      },
    })

    expect(readableStream).toBeInstanceOf(ReadableStream)

    // Test that we can read from the stream
    const reader = readableStream.getReader()
    const decoder = new TextDecoder()

    const chunks: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      chunks.push(decoder.decode(value))
    }

    expect(chunks).toEqual(['Hello', ' world', '!'])
  })
})

// Convert async generator to ReadableStream for AI SDK compatibility
function createReadableStreamFromGenerator(
  generator: AsyncGenerator<string, void, void>,
): ReadableStream<string> {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          controller.enqueue(chunk)
        }
        controller.close()
      }
      catch (error) {
        controller.error(error)
      }
    },
  })
}

// Export the adapter functions for use in examples
export { createReadableStreamFromGenerator, streamEventsToAISDK, streamEventsToCompleteContent }
