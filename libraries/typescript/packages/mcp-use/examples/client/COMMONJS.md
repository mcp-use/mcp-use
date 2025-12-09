# CommonJS Usage Example

This directory contains an example demonstrating how to use `mcp-use` with CommonJS (Node.js `require()` syntax).

## Why CommonJS Support?

While modern JavaScript and TypeScript projects use ESM (ES Modules), many existing projects still use CommonJS. Starting with version 1.10.0+, `mcp-use` provides full CommonJS support to ensure compatibility with these projects.

## Files

- **`commonjs_example.cjs`** - A complete working example showing how to use mcp-use with CommonJS syntax

## Requirements

- Node.js 18.0.0 or higher
- Optional: `OPENAI_API_KEY` environment variable for the agent example

## Usage

```bash
# Run the example directly
node examples/client/commonjs_example.cjs

# Or use the npm script
pnpm example:commonjs
```

## Key Features Demonstrated

1. **CommonJS Imports**: Using `require()` to import mcp-use modules
2. **MCPClient**: Creating and connecting to MCP servers
3. **Session Management**: Getting sessions and listing available tools/resources
4. **MCPAgent**: (Optional) Using an AI agent with MCP tools

## Example Code

```javascript
// CommonJS imports using require()
const { MCPClient, MCPAgent } = require("mcp-use");
const { ChatOpenAI } = require("@langchain/openai");

// Create MCP client
const client = new MCPClient({
  mcpServers: {
    everything: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  },
});

// Connect and use
await client.createAllSessions();
const session = client.getSession("everything");
const tools = await session.listTools();

console.log(`Found ${tools.length} tools`);
```

## Subpath Imports

All mcp-use subpaths are available in CommonJS:

```javascript
// Main exports
const { MCPClient, MCPAgent } = require("mcp-use");

// Agent utilities
const { MCPAgent } = require("mcp-use/agent");

// Server exports
const { MCPServer } = require("mcp-use/server");

// Auth utilities
const { BrowserOAuthClientProvider } = require("mcp-use/auth");

// React hooks (for React apps)
const { useMcp } = require("mcp-use/react");

// Browser utilities
const browserUtils = require("mcp-use/browser");
```

## Testing

CommonJS compatibility is tested in `tests/commonjs-compatibility.test.ts`. To run the tests:

```bash
pnpm test tests/commonjs-compatibility.test.ts
```

## Notes

- The package exports both ESM (`.js`) and CommonJS (`.cjs`) formats
- All main functionality is available in CommonJS
- The CommonJS build is generated automatically during the build process via `tsup`
- TypeScript projects should prefer ESM imports for better type support

## Troubleshooting

### Error: Cannot find module 'mcp-use'

Make sure you have built the package:

```bash
pnpm build
```

### Error: The engine "node" is incompatible

Make sure you're using Node.js 18.0.0 or higher:

```bash
node --version
```

If you need to upgrade Node.js, use a version manager like [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 18
nvm use 18
```
