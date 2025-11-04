/**
 * This example shows how to test the different functionalities of MCPs using the MCP server from
 * anthropic.
 */

import { ChatOpenAI } from "@langchain/openai";
import { config } from "dotenv";
import { Logger, MCPAgent, MCPClient } from "../../index.js";

// Load environment variables from .env file
config();

// Enable debug logging to see observability messages
Logger.setDebug(true);

const everythingServer = {
  mcpServers: {
    everything: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    },
  },
};

async function main() {
  console.log("🚀 Starting MCP Observability example with Langfuse tracing...");
  console.log("📊 Environment variables:");
  console.log(
    `   LANGFUSE_PUBLIC_KEY: ${process.env.LANGFUSE_PUBLIC_KEY ? "✅ Set" : "❌ Missing"}`
  );
  console.log(
    `   LANGFUSE_SECRET_KEY: ${process.env.LANGFUSE_SECRET_KEY ? "✅ Set" : "❌ Missing"}`
  );
  console.log(`   LANGFUSE_HOST: ${process.env.LANGFUSE_HOST || "Not set"}`);
  console.log(
    `   MCP_USE_LANGFUSE: ${process.env.MCP_USE_LANGFUSE || "Not set"}`
  );

  const client = new MCPClient(everythingServer);
  const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
  const agent = new MCPAgent({
    llm,
    client,
    maxSteps: 30,
  });

  // console.log('🔧 Initializing agent...')
  // await agent.initialize()

  // Set additional metadata for testing (Optional)
  agent.setMetadata({
    agent_id: "test-agent-123",
    test_run: true,
    example: "mcp_observability",
  });

  agent.setTags(["test-tag-1", "test-tag-2"]);

  console.log("💬 Running agent query...");
  const result = await agent.run(
    `Hello, you are a tester can you please answer the follwing questions:
- Which resources do you have access to?
- Which prompts do you have access to?
- Which tools do you have access to?`,
    30
  );
  console.log(`\n✅ Result: ${result}`);

  // console.log('🧹 Closing agent...')
  // await agent.close()
  // console.log('🎉 Example completed! Check your Langfuse dashboard for traces.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
