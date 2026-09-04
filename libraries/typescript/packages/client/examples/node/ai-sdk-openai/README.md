# AI SDK + OpenAI + MCP tools

This isolated example connects `@mcp-use/client` to a remote MCP server,
adapts its discovered tools with `createAiSdkTools`, and runs a real two-step
Vercel AI SDK `generateText` loop. The first model step must invoke the remote
`get-metrics` MCP tool; the second step summarizes its returned result.

The AI SDK packages belong to this example only. They are not dependencies,
peer dependencies, optional dependencies, or development dependencies of
`@mcp-use/client`.

## Run

From this directory:

```bash
pnpm install --ignore-workspace --frozen-lockfile
OPENAI_API_KEY=... pnpm start
```

To inject the key from a local Infisical project without writing it to a file:

```bash
infisical run --env=dev --project-config-dir /path/to/infisical-project -- pnpm start
```

The default MCP server is
`https://calm-wave-84sm6.run.mcp-use.com/mcp` and the default model is
`gpt-5.6-luna`. Both can be overridden without editing the example:

```bash
MCP_SERVER_URL=https://your-server.example/mcp OPENAI_MODEL=gpt-5.6-luna pnpm start
```

The program exits unsuccessfully if the server does not expose `get-metrics`
or if the model does not invoke it. Its successful JSON output includes only
the server name/protocol, selected model, invoked tool names, and final text;
it never prints `OPENAI_API_KEY`.
