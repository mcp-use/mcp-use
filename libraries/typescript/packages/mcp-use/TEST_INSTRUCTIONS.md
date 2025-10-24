# Testing Schema Validation Error Recovery

## What Was Changed

A temporary hack was added to `src/adapters/langchain_adapter.ts` to force schema validation errors on all tools. This allows you to test the agent's recovery behavior.

### Changes Made:

1. **`src/adapters/langchain_adapter.ts`** (lines 49-60):
   - Added a temporary hack that adds an impossible required field `_FORCE_SCHEMA_ERROR: 999` to every tool schema
   - This forces validation errors when the agent tries to call tools
   - See the TODO comment - remove this after testing

2. **`src/agents/mcp_agent.ts`** (lines 844-861):
   - Added error handling for `ZodError` and schema validation error messages
   - Agent now catches these errors, converts them to observations, and retries
   - Agent continues executing instead of failing

## How to Test

### 1. Build the package:
```bash
cd libraries/typescript/packages/mcp-use
npm run build
```

### 2. Set up your API key:
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

### 3. Run the test:
```bash
npx tsx test-schema-validation-error.ts
```

## Expected Behavior

**Before the fix:**
```
❌ Error during agent execution step 2: Error: Received tool input did not match expected schema
Agent stopped
```

**After the fix:**
```
⚠️ Schema validation error in step 2: _FORCE_SCHEMA_ERROR: Required
Agent retries with corrected arguments
Agent continues executing
```

## What to Look For

You should see these log messages:

1. `⚠️ HACK ACTIVE: Added impossible schema requirement to tool "..."` - Confirms the hack is working
2. `⚠️ Schema validation error in step X: _FORCE_SCHEMA_ERROR: Required` - Shows the error was caught
3. Agent continues to next step instead of failing

## After Testing

**IMPORTANT:** Remove the temporary hack from `src/adapters/langchain_adapter.ts` (lines 49-60) before committing!

You can quickly find it by searching for `TEMPORARY HACK` or `_FORCE_SCHEMA_ERROR`.

## Alternative: Use Real MCP Server

Instead of the hack, you can also test with a real MCP server that has strict schemas:

```typescript
const mcpConfig = {
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.env.HOME || '/'],
    },
  },
}
```

Then ask the agent to call tools with wrong types to trigger real validation errors.
