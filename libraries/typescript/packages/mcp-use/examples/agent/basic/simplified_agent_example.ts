/**
 * Example demonstrating the new simplified MCPAgent API.
 *
 * The simplified API allows you to create an agent with just an LLM string
 * and server configuration - no need to manually create MCPClient or LLM instances.
 *
 * Note: Make sure to load your environment variables before running this example.
 * Required: OPENAI_API_KEY (or ANTHROPIC_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY)
 */

import { MCPAgent } from "mcp-use/agent";

async function simplifiedModeExample() {
  console.log("🚀 Simplified Mode Example\n");

  // Create agent with simplified API - no manual client/LLM creation needed!
  const agent = new MCPAgent({
    llm: "openai/gpt-4o", // Simple string format: "provider/model"
    mcpServers: {
      filesystem: {
        command: "npx",
        args: [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          process.cwd(), // Use current directory
        ],
      },
    },
    systemPrompt:
      "You are a helpful assistant with access to file system tools.",
    maxSteps: 10,
  });

  try {
    // Run a simple query
    console.log("📝 Running query...\n");
    const result = await agent.run(
      "List the top 5 files in the current directory"
    );

    console.log("\n✅ Result:");
    console.log(result);
  } finally {
    // Clean up - closes both client and LLM automatically
    console.log("\n🧹 Cleaning up...");
    await agent.close();
    console.log("👋 Done!");
  }
}

async function simplifiedModeWithConfigExample() {
  console.log("\n\n🚀 Simplified Mode with Custom LLM Config\n");

  // You can also pass custom LLM configuration
  const agent = new MCPAgent({
    llm: "openai/gpt-4o",
    llmConfig: {
      temperature: 0.3, // More deterministic responses
      maxTokens: 1000,
      // apiKey: 'your-api-key' // Optional: override environment variable
    },
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
      },
    },
    systemPrompt: "You are a concise assistant.",
  });

  try {
    console.log("📝 Running query with custom config...\n");
    const result = await agent.run("What files are in this directory?");

    console.log("\n✅ Result:");
    console.log(result);
  } finally {
    console.log("\n🧹 Cleaning up...");
    await agent.close();
    console.log("👋 Done!");
  }
}

async function multiProviderExample() {
  console.log("\n\n🚀 Multi-Provider Example\n");

  // Try different providers (uncomment the one you want to use)
  const providers = [
    "openai/gpt-4o",
    // "anthropic/claude-3-5-sonnet-20241022",
    // "google/gemini-pro",
    // "groq/llama-3.1-70b-versatile",
  ];

  for (const llmString of providers) {
    console.log(`\n🤖 Testing with ${llmString}...\n`);

    const agent = new MCPAgent({
      llm: llmString,
      mcpServers: {
        filesystem: {
          command: "npx",
          args: [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            process.cwd(),
          ],
        },
      },
    });

    try {
      const result = await agent.run(
        "Tell me the name of one file in this directory"
      );
      console.log(`✅ ${llmString} result: ${result}`);
    } catch (error: any) {
      console.error(`❌ ${llmString} failed: ${error?.message || error}`);
    } finally {
      await agent.close();
    }
  }
}

// Run examples
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      await simplifiedModeExample();
      await simplifiedModeWithConfigExample();
      // await multiProviderExample(); // Uncomment to test multiple providers
    } catch (error) {
      console.error("\n❌ Error:", error);
      process.exit(1);
    }
  })();
}
