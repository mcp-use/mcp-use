/**
 * Stream agent steps and native LLM stream events.
 *
 * Run: pnpm exec tsx examples/advanced/stream_example.ts
 * Requires: OPENAI_API_KEY
 */

import { MCPAgent } from "@mcp-use/agent";
import { requireEnv, simpleServerConfig } from "../_shared.js";

async function streamStepsExample() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    ...simpleServerConfig(),
    maxSteps: 5,
  });

  try {
    const prompt =
      "Use the add tool to calculate 12 + 30. Reply with just the number.";
    console.log("Query:", prompt, "\n");

    let stepNumber = 1;
    for await (const step of agent.stream({ prompt })) {
      console.log(`--- Step ${stepNumber} ---`);
      console.log("Tool:", step.action.tool);
      console.log("Input:", step.action.toolInput);
      console.log("Output:", step.observation);
      stepNumber++;
    }
  } finally {
    await agent.close();
  }
}

async function streamEventsExample() {
  requireEnv("OPENAI_API_KEY");

  const agent = new MCPAgent({
    llm: `openai/${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}`,
    ...simpleServerConfig(),
    maxSteps: 5,
  });

  try {
    const prompt = "Use add to compute 7 + 8 and answer with the number only.";
    console.log("\nNative streamEvents:\n");

    for await (const event of agent.streamEvents({ prompt })) {
      if (event.type === "text-delta") {
        process.stdout.write(event.delta);
      }
      if (event.type === "tool-call-start") {
        console.log("\n[tool-call]", event.toolName);
      }
      if (event.type === "tool-result") {
        console.log("[tool-result]", event.toolName, event.result);
      }
    }
    console.log();
  } finally {
    await agent.close();
  }
}

await streamStepsExample();
await streamEventsExample();
