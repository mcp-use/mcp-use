#!/usr/bin/env node

import { startServer } from "./server/server.js";

// Parse command line arguments
const args = process.argv.slice(2);
let port = 5176;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" && i + 1 < args.length) {
    const parsedPort = Number.parseInt(args[i + 1], 10);
    if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      console.error(
        `Error: Port must be a number between 1 and 65535, got: ${args[i + 1]}`
      );
      process.exit(1);
    }
    port = parsedPort;
    i++;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
🥭 Mango - AI Agent for MCP Server Development

Usage:
  mango [options]

Options:
  --port <port>  Port to run the server on (default: 5176)
  --help, -h     Show this help message

Examples:
  # Run mango on default port
  mango

  # Run on custom port
  mango --port 8080
`);
    process.exit(0);
  }
}

// Start the server
startServer(port);
