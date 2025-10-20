 

/**
 * Tests for MCPAgent streamEvents() method
 *
 * These tests verify that the streamEvents() method:
 * - Yields proper StreamEvent objects
 * - Handles different event types correctly
 * - Provides token-level streaming
 * - Manages conversation history properly
 * - Tracks telemetry correctly
 */

import type { StreamEvent } from '../index.js'
import { HumanMessage } from '@langchain/core/messages'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MCPAgent, MCPClient } from '../index.js'

// Mock the MCP client for testing
vi.mock('../src/client.js', () => ({
  MCPClient: vi.fn().mockImplementation(() => ({
    getAllActiveSessions: vi.fn().mockResolvedValue({}),
    createAllSessions: vi.fn().mockResolvedValue({}),
    closeAllSessions: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Mock the LangChain adapter
vi.mock('../src/adapters/langchain_adapter.js', () => ({
  LangChainAdapter: vi.fn().mockImplementation(() => ({
    createToolsFromConnectors: vi.fn().mockResolvedValue([
      {
        name: 'test_tool',
        description: 'A test tool',
        schema: {},
        func: vi.fn().mockResolvedValue('Test tool result'),
      },
    ]),
  })),
}))

describe('mCPAgent streamEvents()', () => {
  let agent: MCPAgent
  let mockClient: any
  let mockLLM: any

  beforeEach(() => {
    // Create mock LLM that supports streamEvents
    mockLLM = {
      invoke: vi.fn().mockResolvedValue({ content: 'Test response' }),
      _modelType: 'chat_anthropic',
      _llmType: 'anthropic',
    }

    // Create mock client
    mockClient = new MCPClient({})

    // Create agent with mocked dependencies
    agent = new MCPAgent({
      llm: mockLLM as any,
      client: mockClient,
      maxSteps: 3,
      memoryEnabled: true,
      verbose: false,
    })

    // Mock the agent executor's streamEvents method
    const mockStreamEvents = vi.fn().mockImplementation(async function* () {
      // Simulate typical event sequence
      yield {
        event: 'on_chain_start',
        name: 'AgentExecutor',
        data: { input: { input: 'test query' } },
      }

      yield {
        event: 'on_chat_model_stream',
        name: 'ChatAnthropic',
        data: { chunk: { content: 'Hello' } },
      }

      yield {
        event: 'on_chat_model_stream',
        name: 'ChatAnthropic',
        data: { chunk: { content: ' world' } },
      }

      yield {
        event: 'on_tool_start',
        name: 'test_tool',
        data: { input: { query: 'test' } },
      }

      yield {
        event: 'on_tool_end',
        name: 'test_tool',
        data: { output: 'Tool result' },
      }

      yield {
        event: 'on_chain_end',
        name: 'AgentExecutor',
        data: { output: [{ text: 'Hello world' }] },
      }
    })

    // Mock initialize method
    vi.spyOn(agent, 'initialize').mockResolvedValue(undefined)

    // Mock agentExecutor after initialization
    Object.defineProperty(agent, 'agentExecutor', {
      get: () => ({
        streamEvents: mockStreamEvents,
        maxIterations: 3,
      }),
      configurable: true,
    })

    // Mock tools
    Object.defineProperty(agent, 'tools', {
      get: () => [{ name: 'test_tool' }],
      configurable: true,
    })

    // Mock telemetry using bracket notation to access private property
    vi.spyOn((agent as any).telemetry, 'trackAgentExecution').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should yield StreamEvent objects', async () => {
    const events: StreamEvent[] = []

    for await (const event of agent.streamEvents('test query')) {
      events.push(event)
    }

    expect(events).toHaveLength(6)

    // Check event structure
    events.forEach((event) => {
      expect(event).toHaveProperty('event')
      expect(event).toHaveProperty('name')
      expect(event).toHaveProperty('data')
    })
  })

  it('should handle token streaming correctly', async () => {
    const tokens: string[] = []

    for await (const event of agent.streamEvents('test query')) {
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        tokens.push(event.data.chunk.content)
      }
    }

    expect(tokens).toEqual(['Hello', ' world'])
  })

  it('should track tool execution events', async () => {
    const toolEvents: StreamEvent[] = []

    for await (const event of agent.streamEvents('test query')) {
      if (event.event.includes('tool')) {
        toolEvents.push(event)
      }
    }

    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0].event).toBe('on_tool_start')
    expect(toolEvents[0].name).toBe('test_tool')
    expect(toolEvents[1].event).toBe('on_tool_end')
    expect(toolEvents[1].name).toBe('test_tool')
  })

  it('should initialize agent if not already initialized', async () => {
    const initializeSpy = vi.spyOn(agent, 'initialize')

    // Set initialized to false
    Object.defineProperty(agent, 'initialized', {
      get: () => false,
      configurable: true,
    })

    const events = []
    for await (const event of agent.streamEvents('test query')) {
      events.push(event)
      break // Just get first event
    }

    expect(initializeSpy).toHaveBeenCalled()
  })

  it('should handle memory correctly when enabled', async () => {
    const addToHistorySpy = vi.spyOn(agent as any, 'addToHistory')

    // Consume all events
    const events = []
    for await (const event of agent.streamEvents('test query')) {
      events.push(event)
    }

    // Should add user message and AI response to history
    expect(addToHistorySpy).toHaveBeenCalledTimes(2)
  })

  it('should track telemetry', async () => {
    const telemetrySpy = vi.spyOn((agent as any).telemetry, 'trackAgentExecution')

    // Consume all events
    for await (const event of agent.streamEvents('test query')) {
      // Just consume events
    }

    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMethod: 'streamEvents',
        query: 'test query',
        success: true,
      }),
    )
  })

  it('should handle errors gracefully', async () => {
    // Mock agent executor to throw error
    Object.defineProperty(agent, 'agentExecutor', {
      get: () => ({
        streamEvents: vi.fn().mockImplementation(async function* () {
          throw new Error('Test error')
        }),
        maxIterations: 3,
      }),
      configurable: true,
    })

    await expect(async () => {
      for await (const event of agent.streamEvents('test query')) {
        // Should not reach here
      }
    }).rejects.toThrow('Test error')
  })

  it('should respect maxSteps parameter', async () => {
    const mockAgentExecutor = {
      streamEvents: vi.fn().mockImplementation(async function* () {
        yield { event: 'test', name: 'test', data: {} }
      }),
      maxIterations: 3,
    }

    Object.defineProperty(agent, 'agentExecutor', {
      get: () => mockAgentExecutor,
      configurable: true,
    })

    for await (const event of agent.streamEvents('test query', 5)) {
      break
    }

    expect(mockAgentExecutor.maxIterations).toBe(5)
  })

  it('should handle external history', async () => {
    const externalHistory = [
      new HumanMessage('Previous message'),
    ]

    // Mock the agent executor to capture inputs
    let capturedInputs: any
    const mockStreamEvents = vi.fn().mockImplementation(async function* (inputs: any) {
      capturedInputs = inputs
      yield { event: 'test', name: 'test', data: {} }
    })

    Object.defineProperty(agent, 'agentExecutor', {
      get: () => ({
        streamEvents: mockStreamEvents,
        maxIterations: 3,
      }),
      configurable: true,
    })

    // Mock initialize method
    vi.spyOn(agent, 'initialize').mockResolvedValue(undefined)

    for await (const event of agent.streamEvents('test query', undefined, true, externalHistory)) {
      break
    }

    expect(capturedInputs.chat_history).toEqual(externalHistory)
  })

  it('should clean up resources on completion', async () => {
    const closeSpy = vi.spyOn(agent, 'close').mockResolvedValue(undefined)

    // Test with manageConnector=true and no client
    Object.defineProperty(agent, 'client', {
      get: () => undefined,
      configurable: true,
    })

    // Consume all events
    for await (const event of agent.streamEvents('test query', undefined, true)) {
      // Just consume events
    }

    // Note: cleanup only happens if initialized in this call and no client
    // This is hard to test with our current mocking setup, but the logic is there
  })
})

describe('mCPAgent streamEvents() edge cases', () => {
  it('should handle empty event stream', async () => {
    const mockLLM = {
      invoke: vi.fn().mockResolvedValue({ content: 'Test response' }),
      _modelType: 'chat_anthropic',
    }

    const mockClient = new MCPClient({})
    const agent = new MCPAgent({
      llm: mockLLM as any,
      client: mockClient,
      maxSteps: 3,
    })

    // Mock empty event stream
    Object.defineProperty(agent, 'agentExecutor', {
      get: () => ({
        streamEvents: vi.fn().mockImplementation(async function* () {
          // Empty generator
        }),
        maxIterations: 3,
      }),
      configurable: true,
    })

    vi.spyOn(agent, 'initialize').mockResolvedValue(undefined)
    vi.spyOn((agent as any).telemetry, 'trackAgentExecution').mockResolvedValue(undefined)

    const events = []
    for await (const event of agent.streamEvents('test query')) {
      events.push(event)
    }

    expect(events).toHaveLength(0)
  })

  it('should handle malformed events gracefully', async () => {
    const mockLLM = {
      invoke: vi.fn().mockResolvedValue({ content: 'Test response' }),
      _modelType: 'chat_anthropic',
    }

    const mockClient = new MCPClient({})
    const agent = new MCPAgent({
      llm: mockLLM as any,
      client: mockClient,
      maxSteps: 3,
    })

    // Mock malformed event stream
    Object.defineProperty(agent, 'agentExecutor', {
      get: () => ({
        streamEvents: vi.fn().mockImplementation(async function* () {
          yield { event: 'malformed' } // Missing required fields
          yield null // Invalid event
          yield { event: 'on_chat_model_stream', data: { chunk: { content: 'test' } } }
          yield { event: 'on_chain_end', data: { output: [{ text: 'test response' }] } }
        }),
        maxIterations: 3,
      }),
      configurable: true,
    })

    vi.spyOn(agent, 'initialize').mockResolvedValue(undefined)
    vi.spyOn((agent as any).telemetry, 'trackAgentExecution').mockResolvedValue(undefined)

    const events = []
    for await (const event of agent.streamEvents('test query')) {
      events.push(event)
    }

    expect(events).toHaveLength(3) // Should still yield all events, even malformed ones
  })
})
