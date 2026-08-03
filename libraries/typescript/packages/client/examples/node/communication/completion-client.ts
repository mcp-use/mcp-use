/**
 * Prompt and resource-template completion across protocol eras.
 *
 *   cd ../../_demo-servers
 *   pnpm ours:v1  # port 3103
 *   pnpm ours:v2  # port 3104
 *   pnpm exec tsx examples/node/communication/completion-client.ts
 */
import { MCPClient } from "@mcp-use/client";

async function completeV1(): Promise<void> {
  const client = new MCPClient({
    mcpServers: {
      demo: {
        url: "http://127.0.0.1:3103/mcp",
      },
    },
  });
  try {
    const connection = await client.connect("demo");
    const prompt = await connection.complete({
      ref: { type: "ref/prompt", name: "test_prompt_with_arguments" },
      argument: { name: "arg1", value: "def" },
    });
    const resource = await connection.complete({
      ref: { type: "ref/resource", uri: "test://template/{id}/data" },
      argument: { name: "id", value: "b" },
    });
    console.log("v1 prompt:", prompt.completion.values);
    console.log("v1 resource:", resource.completion.values);
  } finally {
    await client.close();
  }
}

async function completeV2(): Promise<void> {
  const client = new MCPClient({
    mcpServers: {
      demo: {
        url: "http://127.0.0.1:3104/mcp",
      },
    },
  });
  try {
    const connection = await client.connect("demo");
    const prompt = await connection.complete({
      ref: { type: "ref/prompt", name: "review-fruit" },
      argument: { name: "fruit", value: "b" },
    });
    console.log("v2 prompt:", prompt.completion.values);
  } finally {
    await client.close();
  }
}

await completeV1();
await completeV2();
