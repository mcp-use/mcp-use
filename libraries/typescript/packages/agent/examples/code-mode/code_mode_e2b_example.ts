/**
 * Code mode with E2B remote sandbox.
 *
 * Run: pnpm exec tsx examples/code-mode/code_mode_e2b_example.ts
 * Requires: ANTHROPIC_API_KEY, E2B_API_KEY, @e2b/code-interpreter
 */

import { ChatAnthropic } from "@langchain/anthropic";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MCPAgent, PROMPTS } from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";
import { ANTHROPIC_MODEL } from "../_shared.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-use-e2b-"));
fs.writeFileSync(path.join(tempDir, "test.txt"), "Hello from E2B code mode");
console.log("Temp dir:", tempDir);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const e2bApiKey = process.env.E2B_API_KEY;
  if (!e2bApiKey) {
    console.error(
      "Missing E2B_API_KEY — get one at https://e2b.dev and install @e2b/code-interpreter"
    );
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
    {
      codeMode: {
        enabled: true,
        executor: "e2b",
        executorOptions: {
          apiKey: e2bApiKey,
          timeoutMs: 300_000,
        },
      },
    }
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
      prompt:
        "List all files in the workspace folder using the filesystem server.",
    })) {
      // prettyStreamEvents prints formatted output
    }
  } finally {
    await agent.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
