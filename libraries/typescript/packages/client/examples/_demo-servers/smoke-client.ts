/**
 * Smoke-test @mcp-use/client against a demo server.
 *   MCP_SERVER_URL=http://127.0.0.1:3101/mcp pnpm exec tsx smoke-client.ts
 */
import { MCPClient } from "../../dist/index.js";

async function main() {
  const url = process.env.MCP_SERVER_URL;
  if (!url) throw new Error("MCP_SERVER_URL required");

  const client = new MCPClient({
    mcpServers: { demo: { url } },
  });

  try {
    const conn = await client.connect("demo");
    console.log(
      "ok",
      "era=",
      conn.protocolEra,
      "version=",
      conn.protocolVersion
    );
    const tools = await conn.listTools();
    console.log(
      "tools",
      tools.map((t) => t.name).join(", ")
    );
    const echo = await conn.callTool("echo", { message: "hi" });
    console.log("echo", JSON.stringify(echo.content));
    const add = await conn.callTool("add", { a: 2, b: 40 });
    console.log("add", JSON.stringify(add.content));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
