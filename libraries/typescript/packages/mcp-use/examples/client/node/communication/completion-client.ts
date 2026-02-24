/**
 * MCP Client Completion Example (Node)
 *
 * Shows how to:
 * 1. Connect to an MCP server with completion support
 * 2. Request autocomplete suggestions for prompt arguments
 * 3. Request completions for resource template URI variables
 *
 * Run:
 *   pnpm run example:client:completion
 *   pnpm run example:completion   (starts server then client)
 *
 * Manually:
 *   1. Start the completion server: pnpm run example:server:completion
 *   2. Run: tsx examples/client/node/communication/completion-client.ts
 */

import { MCPClient } from "mcp-use";

const SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3000/mcp";

async function main() {
  console.log("🚀 Starting Completion Client Example\n");

  const client = new MCPClient({
    mcpServers: {
      completion: {
        url: SERVER_URL,
        clientInfo: { name: "completion-client", version: "1.0.0" },
      },
    },
  });

  try {
    console.log("📡 Connecting to completion server...");
    await client.createAllSessions();
    console.log("✅ Connected!\n");

    const session = client.getSession("completion");
    if (!session) {
      throw new Error("Failed to get session");
    }

    // Test 1: Complete prompt argument with static list (language)
    console.log(
      "🧪 1. Completing 'language' for code-review prompt (prefix: 'py')"
    );
    const langResult = await session.complete({
      ref: { type: "ref/prompt", name: "code-review" },
      argument: { name: "language", value: "py" },
    });
    console.log("   Suggestions:", langResult.completion.values);
    console.log();

    // Test 2: Return all options when prefix is empty
    console.log("🧪 2. Completing 'language' with empty prefix (all options)");
    const allResult = await session.complete({
      ref: { type: "ref/prompt", name: "code-review" },
      argument: { name: "language", value: "" },
    });
    console.log("   Suggestions:", allResult.completion.values);
    console.log();

    // Test 3: Complete prompt argument with dynamic callback (extension)
    console.log(
      "🧪 3. Completing 'extension' for file-search prompt (prefix: '.t')"
    );
    const extResult = await session.complete({
      ref: { type: "ref/prompt", name: "file-search" },
      argument: { name: "extension", value: ".t" },
    });
    console.log("   Suggestions:", extResult.completion.values);
    console.log();

    // Test 4: Complete resource template URI variable
    console.log(
      "🧪 4. Completing 'path' for resource template (prefix: '/home/user')"
    );
    const resourceResult = await session.complete({
      ref: { type: "ref/resource", uri: "file:///{path}" },
      argument: { name: "path", value: "/home/user" },
    });
    console.log("   Suggestions:", resourceResult.completion.values);
    console.log();

    console.log("✅ All completion tests completed successfully!");
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.closeAllSessions();
    console.log("\n👋 Client disconnected");
  }
}

main().catch(console.error);
