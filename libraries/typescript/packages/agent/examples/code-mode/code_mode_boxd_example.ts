/**
 * Code mode with a boxd remote microVM.
 *
 * Run: pnpm exec tsx examples/code-mode/code_mode_boxd_example.ts
 * Requires: ANTHROPIC_API_KEY, BOXD_API_KEY, @boxd-sh/sdk
 * Optional: BOXD_ORG, BOXD_REGION, BOXD_MACHINE_NAME
 */

import { ChatAnthropic } from "@langchain/anthropic";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MCPAgent, PROMPTS } from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";
import { ANTHROPIC_MODEL } from "../_shared.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-use-boxd-"));
fs.writeFileSync(path.join(tempDir, "test.txt"), "Hello from boxd code mode");
console.log("Temp dir:", tempDir);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY");
    process.exit(1);
  }
  const boxdApiKey = process.env.BOXD_API_KEY;
  if (!boxdApiKey) {
    console.error(
      "Missing BOXD_API_KEY: get one at https://boxd.sh?ref=mcp-use and install @boxd-sh/sdk"
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
        executor: "boxd",
        executorOptions: {
          apiKey: boxdApiKey,
          region: process.env.BOXD_REGION ?? "fra",
          name: process.env.BOXD_MACHINE_NAME,
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
        "List all files in the workspace folder using the filesystem server, then read test.txt.",
    })) {
      // prettyStreamEvents prints formatted output
    }
  } finally {
    // Deletes the boxd machine
    await agent.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

await main();
