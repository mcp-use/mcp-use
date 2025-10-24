/**
 * Test file to demonstrate and test schema validation error handling
 *
 * This script shows how to trigger the "Received tool input did not match expected schema" error
 * and verify that the agent recovers gracefully.
 *
 * Run with: tsx test-schema-validation-error.ts
 * Or add to package.json and run: npm run test:schema-error
 */

import { config } from 'dotenv'
import { ChatAnthropic } from '@langchain/anthropic'
import { MCPAgent, MCPClient } from './index.js'

// Load environment variables
config()

async function testSchemaValidationError() {
    console.log('🧪 Testing schema validation error handling...\n')
    console.log('⚠️  HACK MODE: Schema validation errors will be forced for all tools\n')

    // Use the filesystem MCP server for testing (or any other server you have)
    const mcpConfig = {
        mcpServers: {
            filesystem: {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-filesystem', process.env.HOME || '/'],
            },
        },
    }

    // Create MCPClient from config
    const client = new MCPClient(mcpConfig)

    // Create agent (using default adapter which now has the hack)
    const agent = new MCPAgent({
        llm: new ChatAnthropic({
            anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
            modelName: 'claude-3-haiku-20240307',
        }),
        client,
        maxSteps: 4,
        autoInitialize: true,
    })

    try {
        console.log('📝 Testing agent recovery from schema validation errors')
        console.log('📝 Expected behavior:')
        console.log('   1. Agent calls tool without required _FORCE_SCHEMA_ERROR field')
        console.log('   2. Gets schema validation error')
        console.log('   3. Retries with corrected arguments')
        console.log('   4. Still fails validation (impossible requirement)')
        console.log('   5. Eventually reports inability to use the tool\n')

        // Query that will trigger tool calls - watch for schema errors and recovery
        const result = await agent.run(
            'List the files in the current directory, let me know if you have problems',
        )

        console.log('\n✅ Agent execution completed!')
        console.log('Result:', result)
    }
    catch (error) {
        console.error('❌ Test failed:', error)
    }
    finally {
        await agent.close()
    }
}

// Run the test
testSchemaValidationError().catch(console.error)
