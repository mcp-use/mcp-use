#!/usr/bin/env node

/**
 * Simple MCP test server with basic arithmetic tools
 * Used for integration testing
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Create server instance
const server = new Server(
  {
    name: "simple-test-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "add",
        description: "Add two numbers",
        inputSchema: {
          type: "object",
          properties: {
            a: {
              type: "number",
              description: "First number",
            },
            b: {
              type: "number",
              description: "Second number",
            },
          },
          required: ["a", "b"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "add") {
    const a = Number(args?.a);
    const b = Number(args?.b);

    if (Number.isNaN(a) || Number.isNaN(b)) {
      return {
        content: [
          {
            type: "text",
            text: "Error: Both arguments must be valid numbers",
          },
        ],
        isError: true,
      };
    }

    const result = a + b;
    return {
      content: [
        {
          type: "text",
          text: String(result),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Simple MCP test server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
