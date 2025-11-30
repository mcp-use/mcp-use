/**
 * Basic usage example for mcp-use.
 *
 * This example demonstrates how to use the mcp-use library with MCPClient
 * to connect any LLM to MCP tools through a unified interface.
 *
 * Special Thanks to https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
 * for the server.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "../../index.js";

const serverConfig = {
  mcpServers: {
    filesystem: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "THE_PATH_TO_YOUR_DIRECTORY",
      ],
    },
  },
};

async function main() {
  // Create MCPClient from config
  const client = MCPClient.fromDict(serverConfig);

  // Create LLM
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  // const llm = init_chat_model({ model: "llama-3.1-8b-instant", model_provider: "groq" })
  // const llm = new ChatAnthropic({ model: "claude-3-" })
  // const llm = new ChatGroq({ model: "llama3-8b-8192" })

  // Create agent with the client
  const agent = new MCPAgent({ llm, client, maxSteps: 30 });

  // Run the query
  const result = await agent.run(
    "Hello can you give me a list of files and directories in the current directory",
    30
  );
  console.log(`\nResult: ${result}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
