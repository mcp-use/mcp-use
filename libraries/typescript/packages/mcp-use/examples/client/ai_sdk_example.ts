/**
 * AI SDK Integration Example
 *
 * This example demonstrates how to use MCPAgent's streamEvents() method
 * with Vercel AI SDK's LangChainAdapter for building streaming UIs.
 *
 * This pattern is useful for:
 * - Next.js API routes with useCompletion/useChat hooks
 * - Real-time streaming applications
 * - Building chat interfaces with token-by-token updates
 */

import type { StreamEvent } from '../../index.js'
import { ChatAnthropic } from '@langchain/anthropic'
import { LangChainAdapter } from 'ai'
import { config } from 'dotenv'
import { MCPAgent, MCPClient } from '../../index.js'

// Load environment variables
config()

// Utility function to convert streamEvents to AI SDK compatible stream
async function* streamEventsToAISDK(
  streamEvents: AsyncGenerator<StreamEvent, void, void>,
): AsyncGenerator<string, void, void> {
  for await (const event of streamEvents) {
    // Only yield the actual content tokens from chat model streams
    if (event.event === 'on_chat_model_stream' && event.data?.chunk?.text) {
      const textContent = event.data.chunk.text
      if (typeof textContent === 'string' && textContent.length > 0) {
        yield textContent
      }
    }
  }
}

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

// Enhanced adapter that includes tool information
async function* streamEventsToAISDKWithTools(
  streamEvents: AsyncGenerator<StreamEvent, void, void>,
): AsyncGenerator<string, void, void> {
  for await (const event of streamEvents) {
    switch (event.event) {
      case 'on_chat_model_stream':
        if (event.data?.chunk?.text) {
          const textContent = event.data.chunk.text
          if (typeof textContent === 'string' && textContent.length > 0) {
            yield textContent
          }
        }
        break

      case 'on_tool_start':
        yield `\n🔧 Using tool: ${event.name}\n`
        break

      case 'on_tool_end':
        yield `\n✅ Tool completed: ${event.name}\n`
        break
    }
  }
}

// Example: Basic AI SDK API route handler
async function createApiHandler() {
  const everythingServer = {
    mcpServers: {
      everything: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
      },
    },
  }

  const client = new MCPClient(everythingServer)
  const llm = new ChatAnthropic({
    model: 'claude-sonnet-4-20250514',
    temperature: 0.1,
  })

  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 5,
    verbose: false,
  })

  // Simulate an API route handler
  const apiHandler = async (request: { prompt: string }) => {
    try {
      // Get streamEvents from MCPAgent
      const streamEvents = agent.streamEvents(request.prompt)

      // Convert to AI SDK compatible format
      const aiSDKStream = streamEventsToAISDK(streamEvents)
      const readableStream = createReadableStreamFromGenerator(aiSDKStream)

      // Use LangChainAdapter to create a Response compatible with AI SDK
      return LangChainAdapter.toDataStreamResponse(readableStream)
    }
    catch (error) {
      console.error('Error in API handler:', error)
      throw error
    }
    finally {
      await client.closeAllSessions()
    }
  }

  return apiHandler
}

// Example: Enhanced API handler with tool visibility
async function createEnhancedApiHandler() {
  const everythingServer = {
    mcpServers: {
      everything: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-everything'],
      },
    },
  }

  const client = new MCPClient(everythingServer)
  const llm = new ChatAnthropic({
    model: 'claude-sonnet-4-20250514',
    temperature: 0.1,
  })

  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 8,
    verbose: false,
  })

  const enhancedApiHandler = async (request: { prompt: string }) => {
    try {
      const streamEvents = agent.streamEvents(request.prompt)
      const enhancedStream = streamEventsToAISDKWithTools(streamEvents)
      const readableStream = createReadableStreamFromGenerator(enhancedStream)

      return LangChainAdapter.toDataStreamResponse(readableStream)
    }
    catch (error) {
      console.error('Error in enhanced API handler:', error)
      throw error
    }
    finally {
      await client.closeAllSessions()
    }
  }

  return enhancedApiHandler
}

// Example: Simulated Next.js API route
async function simulateNextJSApiRoute() {
  console.log('🚀 Simulating Next.js API Route with AI SDK Integration\n')

  const apiHandler = await createApiHandler()

  // Simulate a request
  const request = {
    prompt: 'What\'s the current time? Also, list the files in the current directory.',
  }

  console.log(`📝 Request: ${request.prompt}\n`)
  console.log('📡 Streaming response:\n')

  try {
    const response = await apiHandler(request)

    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break

        const chunk = decoder.decode(value)
        process.stdout.write(chunk)
      }
    }
  }
  catch (error) {
    console.error('❌ Error:', error)
  }

  console.log('\n\n✅ API Route simulation complete')
}

// Example: Enhanced streaming with tool visibility
async function simulateEnhancedStreaming() {
  console.log('\n\n🚀 Enhanced Streaming with Tool Visibility\n')

  const enhancedHandler = await createEnhancedApiHandler()

  const request = {
    prompt: 'Check the current time and create a file with a timestamp. Then tell me what tools you used.',
  }

  console.log(`📝 Request: ${request.prompt}\n`)
  console.log('📡 Enhanced streaming response:\n')

  try {
    const response = await enhancedHandler(request)

    if (response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break

        const chunk = decoder.decode(value)
        process.stdout.write(chunk)
      }
    }
  }
  catch (error) {
    console.error('❌ Error:', error)
  }

  console.log('\n\n✅ Enhanced streaming complete')
}

// Run all examples
async function runAllExamples() {
  await simulateNextJSApiRoute()
  await simulateEnhancedStreaming()
}

// Export utilities for reuse
export {
  createApiHandler,
  createEnhancedApiHandler,
  createReadableStreamFromGenerator,
  streamEventsToAISDK,
  streamEventsToAISDKWithTools,
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error)
}
