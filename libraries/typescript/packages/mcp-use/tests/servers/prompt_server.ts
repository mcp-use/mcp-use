#!/usr/bin/env node

/**
 * Simple MCP test server with prompts capability.
 * Used by tests/docs/prompts-example.test.ts.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "prompt-test-server", version: "1.0.0" },
  { capabilities: { prompts: {} } }
);

const PROMPTS = [
  {
    name: "simple_prompt",
    description: "A simple test prompt with no arguments",
  },
  {
    name: "code_review",
    description: "Review code for best practices",
    arguments: [
      { name: "code", description: "The code to review", required: true },
    ],
  },
  {
    name: "summarize",
    description: "Summarize text content",
    arguments: [
      { name: "text", description: "The text to summarize", required: true },
      {
        name: "style",
        description: "Summary style (brief or detailed)",
        required: false,
      },
    ],
  },
];

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const prompt = PROMPTS.find((p) => p.name === name);

  if (!prompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  if (name === "simple_prompt") {
    return {
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Hello from simple prompt" },
        },
      ],
    };
  }

  if (name === "code_review") {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please review this code:\n${args?.code ?? ""}`,
          },
        },
      ],
    };
  }

  if (name === "summarize") {
    const style = args?.style ?? "brief";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Summarize (${style}):\n${args?.text ?? ""}`,
          },
        },
      ],
    };
  }

  throw new Error(`Unhandled prompt: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Prompt MCP test server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
