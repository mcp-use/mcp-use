/**
 * Dynamic server management example for mcp-use.
 *
 * This example demonstrates how to equip an MCPAgent with a tool
 * to dynamically add and connect to MCP servers during a run.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY
 */

import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "../../index.js";
import { LangChainAdapter } from "../../src/adapters/langchain_adapter.js";
import { ServerManager } from "../../src/managers/server_manager.js";
import { AddMCPServerFromConfigTool } from "../../src/managers/tools/add_server_from_config.js";

async function main() {
  // Create an empty MCPClient. It has no servers to start with.
  const client = new MCPClient();

  // The LLM to power the agent
  const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

  const serverManager = new ServerManager(client, new LangChainAdapter());
  serverManager.setManagementTools([
    new AddMCPServerFromConfigTool(serverManager),
  ]);

  // Create the agent, enabling the ServerManager
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 30,
    autoInitialize: true,
    useServerManager: true,
    serverManagerFactory: () => serverManager,
  });

  // Define the server configuration that the agent will be asked to add.
  const serverConfigA = {
    command: "npx",
    args: ["@playwright/mcp@latest", "--headless"],
    env: {
      DISPLAY: ":1",
    },
  };
  const serverConfigB = {
    command: "npx",
    args: ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
  };
  // We'll pass the config as a JSON string in the prompt.
  const serverConfigStringA = JSON.stringify(serverConfigA, null, 2);
  const serverConfigStringB = JSON.stringify(serverConfigB, null, 2);

  const query = `I need to browse the web. To do this, please add and connect to a new MCP server for Playwright.
    The server name is 'playwright' and its configuration is:
    \`\`\`json
    ${serverConfigStringA}
    \`\`\`
    Once the server is ready, navigate to https://github.com/mcp-use/mcp-use, give a star to the project, and then provide a concise summary of the project's README.

    Then, please add and connect to a new MCP server for Airbnb.
    The server name is 'airbnb' and its configuration is:
    \`\`\`json
    ${serverConfigStringB}
    \`\`\`
    and give me a house in the location of the company mcp-use.
    `;

  // Run the agent. We call `stream()` to get the async generator.
  const stepIterator = agent.stream(query);
  let result: string;
  while (true) {
    const { done, value } = await stepIterator.next();
    if (done) {
      result = value;
      break;
    }
    // You can inspect the intermediate steps here.
    console.log("--- Agent Step ---");
    console.dir(value, { depth: 4 });
  }

  console.log(`\n✅ Final Result:\n${result}`);

  // Clean up the session created by the agent
  await client.closeAllSessions();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
