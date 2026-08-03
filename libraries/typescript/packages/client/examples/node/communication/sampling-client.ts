/**
 * Sampling callback in both eras:
 * - v1 server→client `sampling/createMessage`
 * - v2 `input_required` multi-round-trip auto-fulfilment
 *
 * Start the mcp-use v1 feature server:
 *   cd ../../_demo-servers && pnpm ours:v1
 *
 * Run:
 *   pnpm exec tsx examples/node/communication/sampling-client.ts
 */
import { MCPClient, type OnSamplingCallback } from "@mcp-use/client";

async function run(
  label: string,
  url: string,
  toolName: string
): Promise<void> {
  let callbackInvoked = false;
  const onSampling: OnSamplingCallback = async (params) => {
    callbackInvoked = true;
    console.log(
      label,
      "sampling request:",
      params.messages.length,
      "message(s)"
    );
    return {
      role: "assistant",
      content: { type: "text", text: "mock sampled response" },
      model: "example-model",
      stopReason: "endTurn",
    };
  };

  const client = new MCPClient({
    mcpServers: {
      [label]: { url, onSampling },
    },
  });

  try {
    const connection = await client.connect(label);
    const result = await connection.callTool(toolName, {
      prompt: "Reply using the client sampling callback",
    });
    if (!callbackInvoked) {
      throw new Error(`${label}: sampling callback was not invoked`);
    }
    console.log(label, JSON.stringify(result.content));
  } finally {
    await client.close();
  }
}

await run(
  "v1",
  process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3103/mcp",
  "test_sampling"
);
await run(
  "v2",
  process.env.MCP_SERVER_V2_URL ?? "http://127.0.0.1:3104/mcp",
  "sample-text"
);
