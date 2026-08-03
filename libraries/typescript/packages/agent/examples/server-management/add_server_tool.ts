/**
 * Dynamically add MCP servers during an agent run (Server Manager).
 *
 * Run: pnpm exec tsx examples/server-management/add_server_tool.ts
 * Requires: OPENAI_API_KEY
 */

import { ChatOpenAI } from "@langchain/openai";
import {
  AddMCPServerFromConfigTool,
  LangChainAdapter,
  MCPAgent,
  ServerManager,
} from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";
import { OPENAI_MODEL } from "../_shared.js";

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }

  const client = new MCPClient();
  const llm = new ChatOpenAI({ model: OPENAI_MODEL, temperature: 0 });
  const serverManager = new ServerManager(client, new LangChainAdapter());
  serverManager.setManagementTools([
    new AddMCPServerFromConfigTool(serverManager),
  ]);

  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 20,
    autoInitialize: true,
    useServerManager: true,
    serverManagerFactory: () => serverManager,
  });

  const playwrightConfig = {
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--headless"],
  };

  const query = `Add and connect an MCP server named 'playwright' with this configuration:
\`\`\`json
${JSON.stringify(playwrightConfig, null, 2)}
\`\`\`
Then navigate to https://example.com and summarize the page in two sentences.`;

  try {
    const stream = agent.stream({ prompt: query });
    let result = "";
    while (true) {
      const { done, value } = await stream.next();
      if (done) {
        result = value;
        break;
      }
      console.log("--- step ---");
      console.log(value.action.tool, value.observation.slice(0, 200));
    }
    console.log("\nFinal:\n", result);
  } finally {
    await client.closeAllSessions();
    await agent.close();
  }
}

await main();
