/**
 * Code mode — MCP tools via in-process code execution.
 *
 * Run: pnpm exec tsx examples/code-mode/code_mode_example.ts
 * Requires: ANTHROPIC_API_KEY
 */

import { ChatAnthropic } from "@langchain/anthropic";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MCPAgent, PROMPTS } from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";
import { ANTHROPIC_MODEL } from "../_shared.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-use-code-mode-"));
const filePath = path.join(tempDir, "test.txt");
fs.writeFileSync(filePath, "Hello, world!");
console.log("Temp dir:", tempDir);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const client = new MCPClient(
    {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", tempDir],
        },
      },
    },
    { codeMode: true }
  );

  const agent = new MCPAgent({
    llm: new ChatAnthropic({ model: ANTHROPIC_MODEL, temperature: 0 }),
    client,
    systemPrompt: PROMPTS.CODE_MODE,
    maxSteps: 30,
    autoInitialize: true,
  });

  try {
    for await (const _ of agent.prettyStreamEvents({
      prompt: "List all files in the workspace folder.",
    })) {
      // prettyStreamEvents prints formatted output
    }
  } finally {
    await agent.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
