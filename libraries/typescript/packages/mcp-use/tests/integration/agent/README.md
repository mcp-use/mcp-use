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

### 2a. `test_agent_stream_events.test.ts`

Tests the `agent.streamEvents()` method for LangChain event-level streaming:

- Yields individual LangChain events (on_chain_start, on_chat_model_stream, on_tool_start, etc.)
- Tracks token-level streaming from the chat model
- Verifies tool execution events with input/output details
- Tests error handling and cleanup with real MCP connections
- Validates event structure and types

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

### 5. `test_agent_observability.test.ts`

Tests observability integration with Langfuse:

- Verifies observability is enabled when configured
- Runs the agent with tracing enabled
- Uses Langfuse API to verify traces were sent
- Tests observability disable flag
- Requires Langfuse API credentials (see Environment Variables below)

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

### Run with npm scripts:

```bash
# Run specific tests using npm scripts
pnpm test:integration:run           # Run test_agent_run.test.ts
pnpm test:integration:stream        # Run test_agent_stream.test.ts
pnpm test:integration:streamevents  # Run test_agent_stream_events.test.ts
pnpm test:integration:structured    # Run test_agent_structured_output.test.ts
pnpm test:integration:manager       # Run test_server_manager.test.ts
pnpm test:integration:observability # Run test_agent_observability.test.ts
```

### Run with verbose output:

```bash
pnpm test tests/integration/agent --reporter=verbose
```

## Requirements

- Node.js >= 20.19.0
- OpenAI API key set in environment (`OPENAI_API_KEY`)
- All dependencies installed (`pnpm install`)

## Environment Variables

These tests require the following environment variables:

```bash
export OPENAI_API_KEY="your-api-key"
```

### Additional Environment Variables for Observability Tests

The observability test (`test_agent_observability.test.ts`) requires:

```bash
export LANGFUSE_PUBLIC_KEY="pk-lf-..."
export LANGFUSE_SECRET_KEY="sk-lf-..."
export LANGFUSE_HOST="https://cloud.langfuse.com"  # Optional, defaults to cloud.langfuse.com
export MCP_USE_LANGFUSE="true"  # Optional, defaults to true if keys are present
```

If these are not set, the observability test will be skipped with a warning message.

## Timeout

Most tests have a timeout of 60 seconds to accommodate:

- MCP server startup
- LLM API calls
- Tool execution
- Agent initialization and cleanup

The observability test has an extended timeout of 120 seconds to allow for:

- Trace flushing to Langfuse
- API calls to verify traces
- Retry logic for trace availability

## Notes

- Tests use GPT-4o for consistent results
- Temperature is set to 0 for deterministic outputs
- Tests automatically clean up resources after execution
- The simple test server runs on stdio transport
