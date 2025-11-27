/**
 * Code Mode E2B Example - Using MCP Tools via E2B Remote Sandbox
 *
 * This example demonstrates how AI agents can use MCP tools through E2B's
 * remote code execution environment, which provides:
 * - Isolated execution environment in the cloud
 * - Better security for untrusted code
 * - Persistent sandboxes across executions
 * - Integration with MCP tools through a bridge pattern
 *
 * Based on Anthropic's research: https://www.anthropic.com/engineering/code-execution-with-mcp
 *
 * Requirements:
 * - E2B API Key: Get one at https://e2b.dev
 * - Install dependency: yarn add @e2b/code-interpreter
 * - Set E2B_API_KEY environment variable
 */

import { ChatAnthropic } from "@langchain/anthropic";
import fs from "node:fs";
import path from "node:path";
import { MCPAgent } from "../../src/agents/mcp_agent.js";
import { MCPClient } from "../../src/client.js";
import { PROMPTS } from "../../src/client/prompts.js";

// create a temporary directory
const tempDir = fs.mkdtempSync("mcp-use-code-mode-e2b-example-");
console.log(`Created temporary directory: ${tempDir}`);
// create a file in the temporary directory
const filePath = path.join(tempDir, "test.txt");
fs.writeFileSync(filePath, "Hello, world!");
console.log(`Created file: ${filePath}`);
// Example configuration with a simple MCP server
// You can replace this with your own server configuration
const config = {
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", tempDir],
    },
  },
};

async function main() {
  // Get E2B API key from environment
  const e2bApiKey = process.env.E2B_API_KEY;
  if (!e2bApiKey) {
    console.error(
      "❌ E2B_API_KEY environment variable is required.\n" +
        "Get your API key at https://e2b.dev and set it as:\n" +
        "  export E2B_API_KEY=your_api_key_here"
    );
    process.exit(1);
  }

  console.log("🚀 Initializing E2B Code Execution Mode...\n");

  // Initialize client with E2B code mode enabled
  // You can configure semantic search mode:
  // - "string_match" (default): Simple substring matching
  // - "fuzzy": Fuzzy search (requires fuse.js)
  // - "embeddings": Semantic search (requires OPENAI_API_KEY or embeddingsUrl)
  const client = new MCPClient(config, {
    codeMode: {
      enabled: true,
      executor: "e2b",
      executorOptions: {
        apiKey: e2bApiKey,
        timeoutMs: 300000, // 5 minutes
      },
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

  console.log("📝 Running example query...\n");

  // Example query
  const query =
    "Please list all the files in the current folder using the filesystem server. ";

  // Stream events with pretty printing
  for await (const _ of agent.prettyStreamEvents(query)) {
    // Events are automatically displayed with syntax highlighting and boxes
  }

  console.log("\n✅ Example completed successfully!");
  console.log("🧹 Cleaning up resources...\n");

  // Clean up: close agent and client connections
  await agent.close();

  console.log("✨ Done!");
}

main()
  .catch((error) => {
    console.error("❌ Error:", error.message);
    process.exit(1);
  })
  .finally(() => {
    // clean up the temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`Deleted temporary directory: ${tempDir}`);
  });
