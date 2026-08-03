/**
 * Playwright MCP browser automation.
 *
 * Run: pnpm exec tsx examples/integrations/browser_use.ts
 * Requires: OPENAI_API_KEY
 */

import { MCPAgent } from "@mcp-use/agent";
import { requireEnv } from "../_shared.js";

async function main() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["-y", "@playwright/mcp@latest", "--headless"],
      },
    },
    maxSteps: 20,
  });

  try {
    const result = await agent.run({
      prompt:
        "Navigate to https://example.com and summarize the page title and main heading in two sentences.",
    });
    console.log(result);
  } finally {
    await agent.close();
  }
}

await main();
