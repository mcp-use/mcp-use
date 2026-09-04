/**
 * Runs a real AI SDK tool loop over an MCP connection.
 *
 * See README.md for installation and environment setup.
 */
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import { createAiSdkTools, MCPClient } from "@mcp-use/client";

const serverUrl =
  process.env.MCP_SERVER_URL ?? "https://calm-wave-84sm6.run.mcp-use.com/mcp";
const modelId = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required to run this example.");
}

async function main(): Promise<void> {
  const client = new MCPClient({
    mcpServers: {
      analytics: { url: serverUrl },
    },
  });

  try {
    const connection = await client.connect("analytics");
    const tools = await createAiSdkTools(connection);

    if (!Object.hasOwn(tools, "get-metrics")) {
      throw new Error(
        "The MCP server did not expose the required get-metrics tool."
      );
    }

    const result = await generateText({
      model: openai(modelId),
      tools,
      stopWhen: stepCountIs(2),
      prompt:
        "Use the get-metrics tool exactly once before answering. Then give a concise summary of the returned analytics. Do not answer without calling the tool.",
    });
    const invokedTools = result.steps.flatMap((step) =>
      step.toolCalls.map((toolCall) => toolCall.toolName)
    );

    if (!invokedTools.includes("get-metrics")) {
      throw new Error("The model completed without invoking get-metrics.");
    }

    console.log(
      JSON.stringify(
        {
          server: connection.info.server?.name ?? "unknown",
          protocolVersion: connection.info.protocolVersion,
          model: modelId,
          invokedTools,
          text: result.text,
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

await main();
