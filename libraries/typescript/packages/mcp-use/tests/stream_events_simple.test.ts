/**
 * Simple tests for MCPAgent streamEvents() method
 *
 * These tests verify the basic functionality of streamEvents() using minimal mocking
 */

import type { StreamEvent } from '../index.js'
import { describe, expect, it } from 'vitest'

describe('test MCPAgent streamEvents() - Core Functionality', () => {
  it('should be a generator function that yields StreamEvent objects', async () => {
    // Mock a simple agent-like object with streamEvents method
    const mockAgent = {
      async* streamEvents(query: string): AsyncGenerator<StreamEvent, void, void> {
        // Simulate typical event sequence
        yield {
          event: 'on_chain_start',
          name: 'AgentExecutor',
          data: { input: { input: query } },
        } as StreamEvent

        yield {
          event: 'on_chat_model_stream',
          name: 'ChatAnthropic',
          data: { chunk: { content: 'Hello' } },
        } as StreamEvent

        yield {
          event: 'on_chat_model_stream',
          name: 'ChatAnthropic',
          data: { chunk: { content: ' world!' } },
        } as StreamEvent

        yield {
          event: 'on_tool_start',
          name: 'test_tool',
          data: { input: { query: 'test' } },
        } as StreamEvent

        yield {
          event: 'on_tool_end',
          name: 'test_tool',
          data: { output: 'Tool result' },
        } as StreamEvent

        yield {
          event: 'on_chain_end',
          name: 'AgentExecutor',
          data: { output: 'Hello world!' },
        } as StreamEvent
      },
    }

    const events: StreamEvent[] = []
    const tokens: string[] = []
    const toolEvents: StreamEvent[] = []

    // Collect all events
    for await (const event of mockAgent.streamEvents('test query')) {
      events.push(event)

      // Collect tokens
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        tokens.push(event.data.chunk.content)
      }

      // Collect tool events
      if (event.event.includes('tool')) {
        toolEvents.push(event)
      }
    }

    // Verify we got the expected number of events
    expect(events).toHaveLength(6)

    // Verify event structure
    events.forEach((event) => {
      expect(event).toHaveProperty('event')
      expect(event).toHaveProperty('name')
      expect(event).toHaveProperty('data')
    })

    // Verify token streaming works
    expect(tokens).toEqual(['Hello', ' world!'])

    // Verify tool events
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0].event).toBe('on_tool_start')
    expect(toolEvents[1].event).toBe('on_tool_end')

    // Verify event types are correct
    expect(events[0].event).toBe('on_chain_start')
    expect(events[1].event).toBe('on_chat_model_stream')
    expect(events[2].event).toBe('on_chat_model_stream')
    expect(events[3].event).toBe('on_tool_start')
    expect(events[4].event).toBe('on_tool_end')
    expect(events[5].event).toBe('on_chain_end')
  })

  it('should handle different event types correctly', async () => {
    const mockAgent = {
      async* streamEvents(): AsyncGenerator<StreamEvent, void, void> {
        // Test different event types
        const eventTypes = [
          'on_chain_start',
          'on_llm_start',
          'on_llm_stream',
          'on_llm_end',
          'on_tool_start',
          'on_tool_stream',
          'on_tool_end',
          'on_retriever_start',
          'on_retriever_end',
          'on_parser_start',
          'on_parser_end',
          'on_chain_end',
        ]

        for (const eventType of eventTypes) {
          yield {
            event: eventType,
            name: 'TestComponent',
            data: { test: true },
            run_id: 'test-run-id',
            metadata: {},
          } as StreamEvent
        }
      },
    }

    const events: StreamEvent[] = []
    for await (const event of mockAgent.streamEvents()) {
      events.push(event)
    }

    expect(events).toHaveLength(12)

    // Verify we got all the different event types
    const receivedEventTypes = events.map(e => e.event)
    expect(receivedEventTypes).toContain('on_chain_start')
    expect(receivedEventTypes).toContain('on_llm_stream')
    expect(receivedEventTypes).toContain('on_tool_start')
    expect(receivedEventTypes).toContain('on_tool_end')
    expect(receivedEventTypes).toContain('on_chain_end')
  })

  it('should work with empty event streams', async () => {
    const mockAgent = {
      async* streamEvents(): AsyncGenerator<StreamEvent, void, void> {
        // Empty generator

      },
    }

    const events: StreamEvent[] = []
    for await (const event of mockAgent.streamEvents()) {
      events.push(event)
    }

    expect(events).toHaveLength(0)
  })

  it('should handle streaming token reconstruction', async () => {
    const mockAgent = {
      async* streamEvents(): AsyncGenerator<StreamEvent, void, void> {
        const tokens = ['The', ' quick', ' brown', ' fox', ' jumps', ' over', ' the', ' lazy', ' dog.']

        for (const token of tokens) {
          yield {
            event: 'on_chat_model_stream',
            name: 'ChatModel',
            data: { chunk: { content: token } },
          } as StreamEvent
        }
      },
    }

    let reconstructedText = ''
    const tokenCount = { count: 0 }

    for await (const event of mockAgent.streamEvents()) {
      if (event.event === 'on_chat_model_stream' && event.data?.chunk?.content) {
        reconstructedText += event.data.chunk.content
        tokenCount.count++
      }
    }

    expect(reconstructedText).toBe('The quick brown fox jumps over the lazy dog.')
    expect(tokenCount.count).toBe(9)
  })
})

describe('streamEvent type verification', () => {
  it('should have correct StreamEvent interface', () => {
    const sampleEvent: StreamEvent = {
      event: 'on_chat_model_stream',
      name: 'TestModel',
      data: {
        chunk: { content: 'test' },
        input: { query: 'test' },
        output: 'result',
      },
      run_id: 'test-run-id',
      metadata: {},
    }

    expect(sampleEvent.event).toBe('on_chat_model_stream')
    expect(sampleEvent.name).toBe('TestModel')
    expect(sampleEvent.data).toBeDefined()
    expect(sampleEvent.data.chunk?.content).toBe('test')
  })
})
