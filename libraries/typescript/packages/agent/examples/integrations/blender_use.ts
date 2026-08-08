/**
 * Blender MCP integration via uvx.
 *
 * Run: pnpm exec tsx examples/integrations/blender_use.ts
 * Requires: ANTHROPIC_API_KEY, Blender MCP addon running (https://github.com/ahujasid/blender-mcp)
 */

import { MCPAgent } from "@mcp-use/agent";
import { requireEnv } from "../_shared.js";

async function main() {
  requireEnv("ANTHROPIC_API_KEY");

  const agent = new MCPAgent({
    llm: `anthropic/${process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001"}`,
    mcpServers: {
      blender: { command: "uvx", args: ["blender-mcp"] },
    },
    maxSteps: 15,
  });

  try {
    const result = await agent.run({
      prompt:
        "List the Blender MCP tools you can access and describe what each one does in one line.",
    });
    console.log(result);
  } catch (error) {
    console.error(
      "Blender example failed. Ensure the Blender MCP addon is installed and its WebSocket server is running."
    );
    throw error;
  } finally {
    await agent.close();
  }
}

await main();
