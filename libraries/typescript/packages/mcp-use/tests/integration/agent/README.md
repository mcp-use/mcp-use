# Integration Tests for MCPAgent

This directory contains end-to-end integration tests for the TypeScript MCPAgent.

## Test Files

### 1. `test_agent_run.test.ts`
Tests the basic `agent.run()` method with MCP tools:
- Connects to a simple MCP server with an `add` tool
- Performs calculations using the tool
- Verifies the result and tool usage

### 2. `test_agent_stream.test.ts`
Tests the `agent.stream()` method for streaming responses:
- Streams agent execution steps
- Verifies intermediate steps are yielded
- Checks tool calls and observations

### 3. `test_agent_structured_output.test.ts`
Tests structured output using Zod schemas:
- Defines a Zod schema for the expected output
- Runs the agent with structured output enabled
- Validates the returned data matches the schema

### 4. `test_server_manager.test.ts`
Tests custom server manager with dynamic tool management:
- Creates a custom server manager
- Dynamically adds tools during execution
- Verifies tools are updated and used correctly

## Test Server

The tests use a simple MCP server located at `tests/servers/simple_server.ts` that provides:
- `add(a, b)`: Adds two numbers

## Running the Tests

### Run all integration tests:
```bash
pnpm test tests/integration/agent
```

### Run a specific test:
```bash
pnpm test tests/integration/agent/test_agent_run.test.ts
```

### Run with verbose output:
```bash
pnpm test tests/integration/agent --reporter=verbose
```

## Requirements

- Node.js >= 22.0.0
- OpenAI API key set in environment (`OPENAI_API_KEY`)
- All dependencies installed (`pnpm install`)

## Environment Variables

These tests require the following environment variables:
```bash
export OPENAI_API_KEY="your-api-key"
```

## Timeout

Each test has a timeout of 60 seconds to accommodate:
- MCP server startup
- LLM API calls
- Tool execution
- Agent initialization and cleanup

## Notes

- Tests use GPT-4o for consistent results
- Temperature is set to 0 for deterministic outputs
- Tests automatically clean up resources after execution
- The simple test server runs on stdio transport

