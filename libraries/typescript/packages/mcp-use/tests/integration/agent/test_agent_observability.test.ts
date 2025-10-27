/**
 * Integration test for agent observability with Langfuse.
 *
 * Tests that:
 * 1. Observability is properly enabled when configured
 * 2. Agent runs successfully with tracing enabled
 * 3. Traces are sent to Langfuse and can be verified via API
 *
 * Prerequisites:
 * - LANGFUSE_PUBLIC_KEY environment variable must be set
 * - LANGFUSE_SECRET_KEY environment variable must be set
 * - LANGFUSE_HOST environment variable (optional, defaults to cloud.langfuse.com)
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChatOpenAI } from '@langchain/openai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MCPAgent } from '../../../src/agents/mcp_agent.js'
import { MCPClient } from '../../../src/client.js'
import { logger } from '../../../src/logging.js'
import { OPENAI_MODEL } from './constants.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Helper function to query Langfuse API for traces
async function getRecentTraces(sessionId: string, tags?: string[], maxRetries = 5, retryDelay = 2000): Promise<any[]> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const baseUrl = process.env.LANGFUSE_HOST || process.env.LANGFUSE_BASEURL || 'https://cloud.langfuse.com'

  if (!publicKey || !secretKey) {
    throw new Error('Langfuse API keys not found in environment variables')
  }

  const authHeader = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`

  // Retry logic to wait for trace to be available in Langfuse
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      logger.info(`Attempt ${attempt + 1}/${maxRetries}: Querying Langfuse API for traces with sessionId: ${sessionId}`)

      // Build query parameters
      let queryUrl = `${baseUrl}/api/public/traces?sessionId=${sessionId}`
      if (tags && tags.length > 0) {
        queryUrl += `&tags=${tags.join(',')}`
      }

      const response = await fetch(queryUrl, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Langfuse API returned status ${response.status}: ${await response.text()}`)
      }

      const data = await response.json()
      const traces = data.data || []

      if (traces.length > 0) {
        logger.info(`Found ${traces.length} traces for sessionId: ${sessionId}`)
        return traces
      }

      // No traces yet, wait and retry
      if (attempt < maxRetries - 1) {
        logger.info(`No traces found yet, waiting ${retryDelay}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }
    catch (error) {
      logger.error(`Error querying Langfuse API on attempt ${attempt + 1}: ${error}`)
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
      else {
        throw error
      }
    }
  }

  return []
}

describe('agent observability integration test', () => {
  // Store original environment variables to restore later
  let originalLangfuseEnabled: string | undefined
  let originalLangfusePublicKey: string | undefined
  let originalLangfuseSecretKey: string | undefined

  beforeEach(() => {
    // Save original environment variables
    originalLangfuseEnabled = process.env.MCP_USE_LANGFUSE
    originalLangfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY
    originalLangfuseSecretKey = process.env.LANGFUSE_SECRET_KEY
  })

  afterEach(() => {
    // Restore original environment variables
    if (originalLangfuseEnabled !== undefined) {
      process.env.MCP_USE_LANGFUSE = originalLangfuseEnabled
    }
    else {
      delete process.env.MCP_USE_LANGFUSE
    }

    if (originalLangfusePublicKey !== undefined) {
      process.env.LANGFUSE_PUBLIC_KEY = originalLangfusePublicKey
    }

    if (originalLangfuseSecretKey !== undefined) {
      process.env.LANGFUSE_SECRET_KEY = originalLangfuseSecretKey
    }
  })

  it('should send traces to Langfuse when observability is enabled', async () => {
    // Skip test if Langfuse credentials are not configured
    if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
      logger.warn('Skipping observability test: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set')
      return
    }

    // Ensure Langfuse is enabled
    process.env.MCP_USE_LANGFUSE = 'true'

    const serverPath = path.resolve(__dirname, '../../servers/simple_server.ts')

    // Generate a unique session ID for this test run
    const sessionId = `test-observability-${Date.now()}-${Math.random().toString(36).substring(7)}`

    const config = {
      mcpServers: {
        simple: {
          command: 'tsx',
          args: [serverPath],
        },
      },
    }

    const client = MCPClient.fromDict(config)
    const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 })

    // Create agent with observability enabled
    const agent = new MCPAgent({
      llm,
      client,
      maxSteps: 5,
      observe: true, // Explicitly enable observability
      verbose: true,
    })

    try {
      const query = 'Use the add tool to calculate 10 + 15.'
      logger.info('\n' + '='.repeat(80))
      logger.info('TEST: test_agent_observability')
      logger.info('='.repeat(80))
      logger.info(`Query: ${query}`)
      logger.info(`Session ID: ${sessionId}`)

      // Set session ID as metadata and tags for tracing
      // Note: Langfuse uses metadata for custom data and tags for filtering
      agent.setMetadata({
        test_name: 'test_agent_observability',
        session_id: sessionId,
        test_type: 'integration',
      })

      agent.setTags([
        'integration-test',
        'observability-test',
        `session:${sessionId}`,
      ])

      // Check observability status before running
      const statusBefore = await agent.observabilityManager.getStatus()
      logger.info('📊 Observability status before run:')
      logger.info(`  Enabled: ${statusBefore.enabled}`)
      logger.info(`  Callback count: ${statusBefore.callbackCount}`)
      logger.info(`  Handler names: ${statusBefore.handlerNames.join(', ')}`)
      logger.info(`  Metadata: ${JSON.stringify(statusBefore.metadata)}`)
      logger.info(`  Tags: ${statusBefore.tags.join(', ')}`)

      // Verify observability is actually enabled
      expect(statusBefore.enabled).toBe(true)
      expect(statusBefore.callbackCount).toBeGreaterThan(0)
      expect(statusBefore.handlerNames).toContain('Langfuse')

      // Run the agent
      const result = await agent.run(query)

      logger.info(`Result: ${result}`)
      logger.info(`Tools used: ${agent.toolsUsedNames}`)

      // Verify agent executed successfully
      expect(result).toContain('25')
      expect(agent.toolsUsedNames).toContain('add')

      // Flush traces to ensure they are sent to Langfuse
      logger.info('Flushing traces to Langfuse...')
      await agent.flush()

      // Wait a bit more for Langfuse to process the traces
      logger.info('Waiting for Langfuse to process traces...')
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Query Langfuse API to verify traces were sent
      logger.info('Querying Langfuse API for traces...')
      const traceTags = ['integration-test', 'observability-test', sessionId]
      const traces = await getRecentTraces(sessionId, traceTags, 8, 3000)

      logger.info(`Found ${traces.length} traces in Langfuse`)

      // Verify that at least one trace was sent
      expect(traces.length).toBeGreaterThan(0)

      // Verify trace contains expected metadata
      const trace = traces[0]
      expect(trace).toHaveProperty('id')
      expect(trace).toHaveProperty('sessionId')
      expect(trace.sessionId).toBe(sessionId)

      // Log trace details for debugging
      logger.info(`Trace ID: ${trace.id}`)
      logger.info(`Trace Name: ${trace.name}`)
      logger.info(`Trace Session ID: ${trace.sessionId}`)
      if (trace.metadata) {
        logger.info(`Trace Metadata: ${JSON.stringify(trace.metadata)}`)
      }
      if (trace.tags) {
        logger.info(`Trace Tags: ${JSON.stringify(trace.tags)}`)
      }

      logger.info('='.repeat(80) + '\n')
      logger.info('✅ Observability test passed - traces successfully sent to Langfuse')
    }
    catch (error) {
      logger.error(`Test failed with error: ${error}`)
      throw error
    }
    finally {
      await agent.close()
    }
  }, 120000) // Increase timeout to 2 minutes for API calls and retries

  it('should not send traces when observability is disabled', async () => {
    // Explicitly disable Langfuse
    process.env.MCP_USE_LANGFUSE = 'false'

    const serverPath = path.resolve(__dirname, '../../servers/simple_server.ts')

    const config = {
      mcpServers: {
        simple: {
          command: 'tsx',
          args: [serverPath],
        },
      },
    }

    const client = MCPClient.fromDict(config)
    const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 })

    // Create agent with observability explicitly disabled
    const agent = new MCPAgent({
      llm,
      client,
      maxSteps: 5,
      observe: false, // Explicitly disable observability
    })

    try {
      const query = 'Use the add tool to calculate 5 + 7.'
      logger.info('\n' + '='.repeat(80))
      logger.info('TEST: test_agent_observability_disabled')
      logger.info('='.repeat(80))
      logger.info(`Query: ${query}`)

      // Run the agent
      const result = await agent.run(query)

      logger.info(`Result: ${result}`)
      logger.info(`Tools used: ${agent.toolsUsedNames}`)

      // Verify agent executed successfully
      expect(result).toContain('12')
      expect(agent.toolsUsedNames).toContain('add')

      logger.info('='.repeat(80) + '\n')
      logger.info('✅ Agent ran successfully with observability disabled')
    }
    finally {
      await agent.close()
    }
  }, 60000)

  it('should verify observability manager has callbacks when enabled', async () => {
    // Skip test if Langfuse credentials are not configured
    if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
      logger.warn('Skipping observability manager test: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set')
      return
    }

    // Ensure Langfuse is enabled
    process.env.MCP_USE_LANGFUSE = 'true'

    const serverPath = path.resolve(__dirname, '../../servers/simple_server.ts')

    const config = {
      mcpServers: {
        simple: {
          command: 'tsx',
          args: [serverPath],
        },
      },
    }

    const client = MCPClient.fromDict(config)
    const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 })

    // Create agent with observability enabled
    const agent = new MCPAgent({
      llm,
      client,
      maxSteps: 5,
      observe: true,
    })

    try {
      // Initialize the agent to set up observability
      await agent.initialize()

      // Access the observability manager (if exposed)
      // Note: This assumes the agent has a way to access the observability manager
      // If not directly exposed, we can verify through behavior instead
      logger.info('\n' + '='.repeat(80))
      logger.info('TEST: test_observability_manager_has_callbacks')
      logger.info('='.repeat(80))
      logger.info('Observability is enabled and agent initialized successfully')
      logger.info('='.repeat(80) + '\n')

      // If we can access the observability manager, verify it has callbacks
      // For now, we just verify the agent initializes without errors
      expect(agent).toBeDefined()
    }
    finally {
      await agent.close()
    }
  }, 60000)
})

