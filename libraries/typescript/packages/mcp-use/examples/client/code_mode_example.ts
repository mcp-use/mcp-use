/**
 * Code Mode Example - Using MCP Tools via Code Execution
 *
 * This example demonstrates how AI agents can use MCP tools through code execution mode,
 * which enables more efficient context usage and data processing compared to
 * direct tool calls.
 *
 * Based on Anthropic's research: https://www.anthropic.com/engineering/code-execution-with-mcp
 */

import { ChatAnthropic } from "@langchain/anthropic";
import fs from "node:fs";
import path from "node:path";
import { MCPAgent } from "../../src/agents/mcp_agent.js";
import { MCPClient } from "../../src/client.js";
import { PROMPTS } from "../../src/client/prompts.js";
// Example configuration with a simple MCP server
// You can replace this with your own server configuration

// create a temporary directory
const tempDir = fs.mkdtempSync("mcp-use-code-mode-example-");
console.log(`Created temporary directory: ${tempDir}`);
// create a file in the temporary directory
const filePath = path.join(tempDir, "test.txt");
fs.writeFileSync(filePath, "Hello, world!");
console.log(`Created file: ${filePath}`);

const config = {
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", tempDir],
    },
  },
};

async function main() {
  // Initialize client with code mode enabled
  // You can configure semantic search mode:
  // - "string_match" (default): Simple substring matching
  // - "fuzzy": Fuzzy search (requires fuse.js)
  // - "embeddings": Semantic search (requires OPENAI_API_KEY or embeddingsUrl)
  const client = new MCPClient(config, {
    codeMode: {
      enabled: true,
      semantic: {
        mode: "string_match", // Change to "fuzzy" or "embeddings" as needed
      },
    },
  });

  // Create LLM
  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
  });

  // Create agent with code mode instructions
  const agent = new MCPAgent({
    llm,
    client,
    systemPrompt: PROMPTS.CODE_MODE,
    maxSteps: 50,
  });

  // Example query
  const query = "Please list all the files in the current folder.";

  // Stream events with pretty printing
  for await (const _ of agent.prettyStreamEvents(query)) {
    // Events are automatically displayed with syntax highlighting and boxes
  }

  // Clean up: close agent and client connections
  await agent.close();
}

main()
  .catch(console.error)
  .finally(() => {
    // clean up the temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`Deleted temporary directory: ${tempDir}`);
  });
