#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import express from 'express';
import { mountInspector } from '../server/middleware.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Parse command line arguments
const args = process.argv.slice(2);
let mcpUrl;
let port = 3100;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && i + 1 < args.length) {
        mcpUrl = args[i + 1];
        i++;
    }
    else if (args[i] === '--port' && i + 1 < args.length) {
        port = parseInt(args[i + 1], 10);
        i++;
    }
    else if (args[i] === '--help' || args[i] === '-h') {
        console.log(`
MCP Inspector - Inspect and debug MCP servers

Usage:
  npx @mcp-use/inspect [options]

Options:
  --url <url>    MCP server URL to auto-connect to (e.g., http://localhost:3000/mcp)
  --port <port>  Port to run the inspector on (default: 3100)
  --help, -h     Show this help message

Examples:
  # Run inspector with auto-connect
  npx @mcp-use/inspect --url http://localhost:3000/mcp

  # Run on custom port
  npx @mcp-use/inspect --url http://localhost:3000/mcp --port 8080

  # Run without auto-connect
  npx @mcp-use/inspect
`);
        process.exit(0);
    }
}
const app = express();
// Mount the inspector
mountInspector(app, '/', mcpUrl);
// Start the server
app.listen(port, () => {
    console.log(`🔍 MCP Inspector running at http://localhost:${port}`);
    if (mcpUrl) {
        console.log(`📡 Auto-connecting to: ${mcpUrl}`);
    }
    console.log(`\nOpen http://localhost:${port} in your browser to inspect MCP servers`);
});
