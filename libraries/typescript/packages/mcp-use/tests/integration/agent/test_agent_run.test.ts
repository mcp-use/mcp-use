/**
 * End-to-end integration test for agent.run().
 *
 * Tests the agent.run() method performing calculations using MCP tools.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ChatOpenAI } from '@langchain/openai'
import { describe, expect, it } from 'vitest'
import { MCPAgent } from '../../../src/agents/mcp_agent.js'
import { MCPClient } from '../../../src/client.js'
import { logger } from '../../../src/logging.js'
import { OPENAI_MODEL } from './constants.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('agent.run() integration test', () => {
  it('should perform calculations using MCP tools', async () => {
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
    const agent = new MCPAgent({ llm, client, maxSteps: 10 })

    try {
      const query = 'Use the add tool to calculate 42 + 58. Just give me the answer.'
      logger.info('\n' + '='.repeat(80))
      logger.info('TEST: test_agent_run')
      logger.info('='.repeat(80))
      logger.info(`Query: ${query}`)

      const result = await agent.run(query)

      logger.info(`Result: ${result}`)
      logger.info(`Tools used: ${agent.toolsUsedNames}`)
      logger.info('='.repeat(80) + '\n')

      expect(result).toContain('100')

      // Check if add tool was used
      expect(agent.toolsUsedNames).toContain('add')
    }
    finally {
      await agent.close()
    }
  }, 60000)
})

