/**
 * CommonJS host loading ESM-only @mcp-use/client via dynamic import().
 *
 * Defaults to the local demo HTTP server. Override with MCP_SERVER_URL, or set
 * USE_STDIO_EVERYTHING=1 to use npx @modelcontextprotocol/server-everything.
 *
 *   MCP_SERVER_URL=http://127.0.0.1:3101/mcp node examples/browser/commonjs/commonjs_example.cjs
 *   MCP_SERVER_URL=http://127.0.0.1:3102/mcp node examples/browser/commonjs/commonjs_example.cjs
 */

async function runCommonJSExample() {
  const { MCPClient } = await import("@mcp-use/client");
  console.log("=== CommonJS MCP Example ===\n");

  const useStdio = process.env.USE_STDIO_EVERYTHING === "1";
  const url = process.env.MCP_SERVER_URL ?? "http://127.0.0.1:3102/mcp";

  const client = new MCPClient({
    mcpServers: useStdio
      ? {
          everything: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-everything"],
          },
        }
      : {
          demo: { url },
        },
  });

  try {
    const name = useStdio ? "everything" : "demo";
    const connection = await client.connect(name);
    console.log("✓ Connected", `(era=${connection.protocolEra ?? "?"})`);

    const tools = await connection.listTools();
    console.log(`✓ Found ${tools.length} tools`);
    for (const tool of tools.slice(0, 5)) {
      console.log(`  - ${tool.name}`);
    }

    if (tools.some((t) => t.name === "echo")) {
      const result = await connection.callTool("echo", { message: "cjs" });
      console.log("✓ echo ->", JSON.stringify(result.content));
    }

    console.log("\n=== CommonJS Example Completed Successfully ===");
  } catch (error) {
    console.error("Error:", error.message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

runCommonJSExample().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
