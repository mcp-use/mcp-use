/**
 * Browser entry of @mcp-use/client, runnable under Node via tsx for CI smoke.
 * Same API as examples/node/basic-http.ts — bundlers resolve the browser
 * export condition automatically in real apps.
 *
 *   MCP_SERVER_URL=http://127.0.0.1:3101/mcp pnpm exec tsx examples/browser/basic-http.ts
 *   MCP_SERVER_URL=http://127.0.0.1:3102/mcp pnpm exec tsx examples/browser/basic-http.ts
 */

import { MCPClient } from "@mcp-use/client";

const SERVER_URL = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3102/mcp";

async function main(): Promise<void> {
  console.log("Browser basic HTTP example");
  console.log("Server:", SERVER_URL);

  const client = new MCPClient({
    mcpServers: {
      demo: { url: SERVER_URL },
    },
  });

  try {
    const connection = await client.connect("demo");
    console.log(
      "connected",
      `era=${connection.protocolEra ?? "?"}`,
      `version=${connection.info.protocolVersion}`
    );

    const tools = await connection.listTools();
    console.log("tools:", tools.map((t) => t.name).join(", "));

    const echo = await connection.callTool("echo", { message: "hello" });
    console.log("echo ->", JSON.stringify(echo.content));

    const add = await connection.callTool("add", { a: 20, b: 22 });
    console.log("add  ->", JSON.stringify(add.content));

    console.log("done");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
