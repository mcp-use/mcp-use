# Simplified MCPAgent API Implementation

## Overview

The MCPAgent now supports a simplified initialization mode that drastically reduces boilerplate code while maintaining full backward compatibility with the existing explicit mode.

## What Changed

### Before (Explicit Mode)
```typescript
import { MCPClient } from 'mcp-use'
import { MCPAgent } from 'mcp-use/agent'
import { ChatOpenAI } from '@langchain/openai'

const client = new MCPClient({
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', './workspace']
    }
  }
})
await client.createAllSessions()

const llm = new ChatOpenAI({
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY
})

const agent = new MCPAgent({ llm, client })
const result = await agent.run('List TypeScript files')

await agent.close()
await client.closeAllSessions()
```

### After (Simplified Mode)
```typescript
import { MCPAgent } from 'mcp-use/agent'

const agent = new MCPAgent({
  llm: 'openai/gpt-4o',
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', './workspace']
    }
  }
})

const result = await agent.run('List TypeScript files')
await agent.close() // Cleans up everything
```

## Key Features

### 1. String-based LLM Configuration
Simply specify the provider and model as a string:
- `'openai/gpt-4o'`
- `'anthropic/claude-3-5-sonnet-20241022'`
- `'google/gemini-pro'`
- `'groq/llama-3.1-70b-versatile'`

### 2. Automatic Resource Management
The agent handles:
- Dynamic LLM package importing
- API key detection from environment variables
- MCPClient creation and lifecycle
- Complete cleanup on `close()`

### 3. Optional LLM Configuration
```typescript
const agent = new MCPAgent({
  llm: 'openai/gpt-4o',
  llmConfig: {
    temperature: 0.7,
    maxTokens: 2000,
    apiKey: 'custom-key' // Optional override
  },
  mcpServers: { /* ... */ }
})
```

### 4. Full Backward Compatibility
All existing code continues to work without any changes. The explicit mode is still fully supported for advanced use cases.

## Implementation Details

### New Files Created

1. **`src/agents/utils/llm_provider.ts`**
   - LLM string parsing (`parseLLMString`)
   - Dynamic package importing (`createLLMFromString`)
   - API key detection from environment variables
   - Support for OpenAI, Anthropic, Google, and Groq

2. **`examples/client/simplified_agent_example.ts`**
   - Demonstrates simplified mode usage
   - Shows custom LLM configuration
   - Multi-provider examples

### Modified Files

1. **`src/agents/types.ts`**
   - Added `MCPAgentOptions` union type
   - Added `ExplicitModeOptions` and `SimplifiedModeOptions`
   - Added `MCPServerConfig` interface
   - Added `LLMConfig` type
   - Moved `LanguageModel` type here

2. **`src/agents/mcp_agent.ts`**
   - Updated constructor to accept `MCPAgentOptions`
   - Added mode detection logic (string vs object LLM)
   - Added private fields for simplified mode tracking
   - Enhanced `initialize()` to create client and LLM in simplified mode
   - Enhanced `close()` to clean up internally-created resources
   - Added ownership tracking (`clientOwnedByAgent` flag)

3. **`src/agents/utils/index.ts`**
   - Exported LLM provider utilities

4. **`src/agents/index.ts`**
   - Exported new types for public API

5. **`docs/typescript/agent/index.mdx`**
   - Added "Simplified Mode" section to Quick Start
   - Added "Explicit Mode" section for advanced users
   - Updated Agent Lifecycle with both modes
   - Added LLM configuration examples

6. **`package.json`**
   - Added `example:simplified` script

## Supported LLM Providers

| Provider | String Format | Environment Variable | Package Required |
|----------|---------------|---------------------|------------------|
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` | `@langchain/openai` |
| Anthropic | `anthropic/claude-3-5-sonnet-20241022` | `ANTHROPIC_API_KEY` | `@langchain/anthropic` |
| Google | `google/gemini-pro` | `GOOGLE_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` | `@langchain/google-genai` |
| Groq | `groq/llama-3.1-70b-versatile` | `GROQ_API_KEY` | `@langchain/groq` |

## Error Handling

The implementation provides clear error messages:

- **Package not installed**: 
  ```
  Package '@langchain/openai' is not installed. 
  Install it with: npm install @langchain/openai or yarn add @langchain/openai
  ```

- **API key not found**:
  ```
  API key not found for provider 'openai'. 
  Set OPENAI_API_KEY environment variable or pass apiKey in llmConfig.
  ```

- **Invalid format**:
  ```
  Invalid LLM string format. Expected 'provider/model', got '...'
  Examples: 'openai/gpt-4', 'anthropic/claude-3-5-sonnet-20241022'
  ```

## Type Safety

The implementation uses TypeScript discriminated unions to ensure type safety:

```typescript
// TypeScript knows which options are available based on the mode
const explicitAgent = new MCPAgent({
  llm: someLLMInstance,    // Object
  client: someClient,      // Required for explicit mode
  // mcpServers: {},       // ❌ Not allowed in explicit mode
})

const simplifiedAgent = new MCPAgent({
  llm: 'openai/gpt-4o',   // String
  mcpServers: {},          // Required for simplified mode
  // client: someClient,   // ❌ Not allowed in simplified mode
})
```

## Testing

Run the example to test the simplified mode:

```bash
# Make sure you have OPENAI_API_KEY set
export OPENAI_API_KEY=your-key

# Run the simplified mode example
yarn example:simplified
```

## Migration Guide

### For New Projects
Use simplified mode by default - it's simpler and requires less code.

### For Existing Projects
No changes needed! Your existing code will continue to work exactly as before. When you're ready, you can optionally migrate to simplified mode for new agents.

## Benefits

1. **Less Boilerplate**: ~50% reduction in initialization code
2. **Easier to Read**: Clear, declarative configuration
3. **Better DX**: No need to remember import paths for LLM packages
4. **Automatic Cleanup**: Single `close()` call cleans up everything
5. **Type Safe**: Full TypeScript support with discriminated unions
6. **Backward Compatible**: Zero breaking changes

## Conclusion

The simplified MCPAgent API significantly improves the developer experience while maintaining full backward compatibility. New users can get started faster, while advanced users retain full control through the explicit mode.
