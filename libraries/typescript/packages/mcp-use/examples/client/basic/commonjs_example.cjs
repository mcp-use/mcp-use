/**
 * CommonJS Example - Simple MCP Client Usage
 *
 * This example demonstrates how to use mcp-use with CommonJS (require) syntax.
 * This is useful for projects that haven't migrated to ESM yet or need to use
 * CommonJS for compatibility reasons.
 *
 * Note: Make sure to have Node.js 18.0.0 or higher installed.
 * Required: OPENAI_API_KEY environment variable
 *
 * Usage:
 *   node examples/client/commonjs_example.cjs
 */

// CommonJS imports using require()
const { MCPClient, MCPAgent } = require("../../../dist/index.cjs");
const { ChatOpenAI } = require("@langchain/openai");

async function runCommonJSExample() {
  console.log("=== CommonJS MCP Example ===\n");

  try {
    // Create MCP client with a simple server
    const client = new MCPClient({
      mcpServers: {
        everything: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-everything"],
        },
      },
    });

    console.log("✓ MCPClient created successfully with CommonJS");

    // Connect to all servers
    await client.createAllSessions();
    console.log("✓ Connected to MCP servers");

    // Get a session
    const session = client.getSession("everything");
    console.log("✓ Session retrieved");

    // List available tools
    const tools = await session.listTools();
    console.log(`✓ Found ${tools.length} available tools`);

    // Display first few tools
    console.log("\nAvailable tools:");
    tools.slice(0, 5).forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description || "No description"}`);
    });

    // List available resources
    const resources = await session.listResources();
    const resourceList = Array.isArray(resources)
      ? resources
      : resources.resources || [];
    console.log(`\n✓ Found ${resourceList.length} available resources`);

    // Display first few resources
    if (resourceList.length > 0) {
      console.log("\nAvailable resources:");
      resourceList.slice(0, 5).forEach((resource) => {
        console.log(
          `  - ${resource.name}: ${resource.description || "No description"}`
        );
      });
    }

    // Create an agent with LLM (if API key is available)
    if (process.env.OPENAI_API_KEY) {
      console.log("\n=== Testing MCPAgent ===");
      const llm = new ChatOpenAI({ model: "gpt-4o-mini" });
      const agent = new MCPAgent({
        llm,
        client,
        maxSteps: 5,
      });

      console.log("✓ MCPAgent created successfully with CommonJS");

      // Test a simple query
      const response = await agent.run(
        "List the available tools and describe what they do in one sentence."
      );
      console.log("\nAgent response:");
      console.log(response);
    } else {
      console.log("\n⚠ OPENAI_API_KEY not set - skipping agent test");
    }

    // Cleanup
    await client.closeAllSessions();
    console.log("\n✓ All sessions closed successfully");

    console.log("\n=== CommonJS Example Completed Successfully ===");
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  runCommonJSExample().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { runCommonJSExample };
