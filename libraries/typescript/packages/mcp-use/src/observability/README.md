# Observability Module

This module provides comprehensive observability for MCP agents using LangChain, supporting Langfuse observability platform.

## Features

- **Langfuse integration**: Comprehensive observability with Langfuse
- **Automatic instrumentation**: Zero-code observability with environment variables
- **Custom callbacks**: Support for custom LangChain callback handlers
- **TypeScript-first**: Full TypeScript support with proper types
- **Serverless-ready**: Proper shutdown handling for serverless environments

## Installation

Install the required packages based on your observability platform:

```bash
# For Langfuse
npm install langfuse @langfuse/langchain
```

## Configuration

### Langfuse

Set the following environment variables:

```env
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com  # Optional
MCP_USE_LANGFUSE=true  # Set to false to disable
```

## Usage

### Basic Usage with MCPAgent

The observability is automatically integrated into MCPAgent:

```typescript
import { MCPAgent } from 'mcp-use'

const agent = new MCPAgent({
  llm: myLLM,
  client: myMCPClient,
  // Observability is automatically enabled if environment variables are set
})

// Initialize the agent
await agent.initialize()

// Run queries - they will be automatically traced
const result = await agent.run('What\'s the weather?')
```

### Custom Callbacks

You can provide custom callbacks:

```typescript
import { CallbackHandler } from '@langfuse/langchain'
import { MCPAgent } from 'mcp-use'

const customHandler = new CallbackHandler({
  secretKey: 'custom-secret',
  publicKey: 'custom-public',
})

const agent = new MCPAgent({
  llm: myLLM,
  client: myMCPClient,
  callbacks: [customHandler], // Use custom callbacks instead of auto-detected ones
})
```

### Direct ObservabilityManager Usage

For advanced use cases, you can use the ObservabilityManager directly:

```typescript
import { ObservabilityManager } from 'mcp-use/observability'

// Create a manager
const manager = new ObservabilityManager({
  verbose: true, // Enable verbose logging
})

// Get available callbacks
const callbacks = await manager.getCallbacks()

// Check available handlers
const handlerNames = await manager.getHandlerNames()
console.log('Available handlers:', handlerNames)

// Add custom callback
manager.addCallback(myCustomCallback)

// Shutdown (important for serverless)
await manager.shutdown()
```

## Platform Features

### Langfuse Features

- Detailed LLM call tracing
- Chain execution tracking
- Tool usage monitoring
- Cost tracking
- Custom metadata and tags
- Session management
- User tracking

## Serverless Considerations

For serverless environments (AWS Lambda, Vercel, etc.), ensure proper shutdown:

```typescript
const agent = new MCPAgent({ /* ... */ })

try {
  await agent.initialize()
  const result = await agent.run(query)
  return result
}
finally {
  // Important: Ensure traces are flushed
  await agent.close()
}
```

## Debugging

Enable debug logging to see observability events:

```typescript
import { logger } from 'mcp-use/logging'

// Set log level to debug
process.env.LOG_LEVEL = 'debug'

// Now you'll see detailed observability logs
```

## Environment Variables Reference

### Langfuse

- `LANGFUSE_PUBLIC_KEY` - Required: Your Langfuse public key
- `LANGFUSE_SECRET_KEY` - Required: Your Langfuse secret key
- `LANGFUSE_HOST` / `LANGFUSE_BASEURL` - Optional: Langfuse API URL (default: https://cloud.langfuse.com)
- `LANGFUSE_RELEASE` - Optional: Release/version identifier
- `LANGFUSE_FLUSH_AT` - Optional: Batch size for flushing (default: 15)
- `LANGFUSE_FLUSH_INTERVAL` - Optional: Flush interval in ms (default: 10000)
- `LANGFUSE_REQUEST_TIMEOUT` - Optional: Request timeout in ms (default: 10000)
- `LANGFUSE_ENABLED` - Optional: Set to "false" to disable
- `MCP_USE_LANGFUSE` - Optional: Set to "false" to disable Langfuse integration

## Examples

See the [examples](../../examples/) directory for complete working examples:

- Basic observability setup
- Multi-platform configuration
- Custom callback handlers
- Serverless deployments
