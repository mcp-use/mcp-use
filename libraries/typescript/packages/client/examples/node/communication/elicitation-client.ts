/**
 * Form elicitation in both eras:
 * - v1 server→client `elicitation/create`
 * - v2 `input_required` multi-round-trip auto-fulfilment
 *
 *   cd ../../_demo-servers && pnpm ours:v1
 *   pnpm exec tsx examples/node/communication/elicitation-client.ts
 */
import {
  acceptWithDefaults,
  MCPClient,
  type OnElicitationCallback,
} from "@mcp-use/client";

async function run(
  label: string,
  url: string,
  toolName: string
): Promise<void> {
  let callbackInvoked = false;
  const onElicitation: OnElicitationCallback = async (params) => {
    callbackInvoked = true;
    console.log(label, "elicitation request:", params.message);
    return acceptWithDefaults(params);
  };

  const client = new MCPClient({
    mcpServers: {
      [label]: { url, onElicitation },
    },
  });

  try {
    const connection = await client.connect(label);
    const result = await connection.callTool(toolName, {});
    if (!callbackInvoked) {
      throw new Error(`${label}: elicitation callback was not invoked`);
    }
    console.log(label, JSON.stringify(result.content));
  } finally {
    await client.close();
  }
}

await run(
  "v1",
  process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3103/mcp",
  "test_elicitation"
);
await run(
  "v2",
  process.env.MCP_SERVER_V2_URL ?? "http://127.0.0.1:3104/mcp",
  "collect-user-info"
);
