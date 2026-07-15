# CommonJS host + ESM client

`@mcp-use/client` is **ESM-only**. From a CommonJS file, load it with dynamic `import()`.

## Run

```bash
# Start a demo first: cd ../_demo-servers && PORT=3102 pnpm v2
MCP_SERVER_URL=http://127.0.0.1:3101/mcp node commonjs_example.cjs
MCP_SERVER_URL=http://127.0.0.1:3102/mcp node commonjs_example.cjs

# Optional: stdio server-everything instead of HTTP
USE_STDIO_EVERYTHING=1 node commonjs_example.cjs
```

Run from `packages/client` so Node resolves the workspace package (after `pnpm build`).

## Pattern

```javascript
async function main() {
  const { MCPClient } = await import("@mcp-use/client");
  const client = new MCPClient({
    mcpServers: {
      demo: { url: "http://127.0.0.1:3102/mcp" },
    },
  });
  const connection = await client.connect("demo");
  console.log(await connection.listTools());
  await client.close();
}
```

Do not `require("@mcp-use/client")` — there is no CJS build. Node OAuth helpers live on the Node entry (`NodeOAuthClientProvider`); browser OAuth is not exported from Node.
