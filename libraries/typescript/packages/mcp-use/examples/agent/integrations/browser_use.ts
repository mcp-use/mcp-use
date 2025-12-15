/**
 * Basic usage example for mcp-use.
 *
 * This example demonstrates how to use the mcp-use library with MCPClient
 * to connect any LLM to MCP tools through a unified interface.
 *
 * Special thanks to https://github.com/microsoft/playwright-mcp for the server.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "../../../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const config = {
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@latest"],
        env: {
          DISPLAY: ":1",
        },
      },
    },
  };
  // Create MCPClient from config file
  const client = new MCPClient(config);
  // Create LLM
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  // const llm = init_chat_model({ model: "llama-3.1-8b-instant", model_provider: "groq" })
  // const llm = new ChatAnthropic({ model: "claude-3-" })
  // const llm = new ChatGroq({ model: "llama3-8b-8192" })

  // Create agent with the client
  const agent = new MCPAgent({ llm, client, maxSteps: 30 });

  // Run the query
  const result = await agent.run({
    prompt: `Navigate to https://github.com/mcp-use/mcp-use, give a star to the project and write
a summary of the project.`,
    maxSteps: 30,
  });
  console.error(`\nResult: ${result}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
