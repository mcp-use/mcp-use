#!/usr/bin/env node
/**
 * Minimal stdio MCP server with an `add` tool for agent integration tests and examples.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "simple-test-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "add",
      description: "Add two numbers",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" },
        },
        required: ["a", "b"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "add") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const a = Number(request.params.arguments?.a);
  const b = Number(request.params.arguments?.b);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return {
      content: [
        { type: "text", text: "Error: both arguments must be numbers" },
      ],
      isError: true,
    };
  }

  return { content: [{ type: "text", text: String(a + b) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
