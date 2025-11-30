/**
 * Simple chat example using MCPAgent with built-in conversation memory.
 *
 * This example demonstrates how to use the MCPAgent with its built-in
 * conversation history capabilities for better contextual interactions.
 *
 * Special thanks to https://github.com/microsoft/playwright-mcp for the server.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import readline from "node:readline";
import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "../../index.js";

async function runMemoryChat() {
  // Config file path - change this to your config file
  const config = {
    mcpServers: {
      airbnb: {
        command: "npx",
        args: ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
      },
    },
  };

  console.error("Initializing chat...");

  // Create MCP client and agent with memory enabled
  const client = new MCPClient(config);
  const llm = new ChatOpenAI({ model: "gpt-4o-mini" });

  // Create agent with memory_enabled=true
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 15,
    memoryEnabled: true, // Enable built-in conversation memory
  });

  console.error("\n===== Interactive MCP Chat =====");
  console.error("Type 'exit' or 'quit' to end the conversation");
  console.error("Type 'clear' to clear conversation history");
  console.error("==================================\n");

  // Create readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  try {
    // Main chat loop
    while (true) {
      // Get user input
      const userInput = await question("\nYou: ");

      // Check for exit command
      if (
        userInput.toLowerCase() === "exit" ||
        userInput.toLowerCase() === "quit"
      ) {
        console.error("Ending conversation...");
        break;
      }

      // Check for clear history command
      if (userInput.toLowerCase() === "clear") {
        agent.clearConversationHistory();
        console.error("Conversation history cleared.");
        continue;
      }

      // Get response from agent
      process.stdout.write("\nAssistant: ");

      try {
        // Run the agent with the user input (memory handling is automatic)
        const response = await agent.run(userInput);
        console.error(response);
      } catch (error) {
        console.error(`\nError: ${error}`);
      }
    }
  } finally {
    // Clean up
    rl.close();
    await client.closeAllSessions();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMemoryChat().catch(console.error);
}
