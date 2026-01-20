#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "resource-test-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [] };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        name: "hello",
        uri: "resource://hello",
        description: "Hello resource",
        mimeType: "text/plain",
      },
    ],
  };
});

const ADVERTISED_RESOURCES = new Set(["resource://hello"]);

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  // Validate that the URI is advertised by this server
  if (!ADVERTISED_RESOURCES.has(uri)) {
    throw new Error(`Unknown resource URI: ${uri}`);
  }

  return {
    contents: [
      {
        uri,
        mimeType: "text/plain",
        text: "Hello from resource server",
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Resource MCP test server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
