# Client Info & Capability Access Example

This example demonstrates how to use `ctx.client` — the per-connection client information object available in every tool, resource, and prompt callback — to create conditional experiences based on who is connecting to your MCP server.

## Features

Three tools showcase different aspects of the API:

| Tool | What it shows |
|---|---|
| `who-is-connected` | Human-readable summary of the client: name, version, capabilities, MCP Apps support |
| `get-capabilities` | Full capabilities JSON — useful for debugging and model inspection |
| `adaptive-greeting` | Conditional response: widget for MCP Apps clients, plain text for everyone else |

## `ctx.client` API

```typescript
ctx.client.info()           // { name?, version? } from the initialize handshake
ctx.client.capabilities()   // full capabilities object
ctx.client.can("sampling")  // true if client advertised a top-level capability
ctx.client.extension(id)    // raw settings for an MCP extension (SEP-1724)
ctx.client.supportsApps()   // true if client advertises io.modelcontextprotocol/ui (SEP-1865)
```

> **Per-connection**: all values reflect the specific client that made the current request. Different clients connecting to the same server can return different results.

## Running the Server

```bash
# Development mode (with hot reload and Inspector UI)
pnpm dev

# Production mode
pnpm build
pnpm start
```

The server starts on port 3000 by default (override with `PORT` env var). The MCP Inspector is available at `http://localhost:3000/inspector`.

## Testing with the Inspector

1. Run `pnpm dev`
2. Open `http://localhost:3000/inspector`
3. Call `who-is-connected` — you will see the Inspector reported as the client
4. Call `get-capabilities` — inspect the full JSON output
5. Call `adaptive-greeting` with `{ "name": "Alice" }` — the Inspector does not advertise MCP Apps, so you will receive the plain-text path

## Testing with an MCP Apps-capable client

Connect Claude Desktop or any SEP-1865-compliant client to `http://localhost:3000/mcp`. Call `adaptive-greeting` and you will receive the widget response instead of plain text.

## Key Pattern: Adaptive Responses

```typescript
server.tool(
  { name: "my-tool", schema: z.object({ query: z.string() }) },
  async ({ query }, ctx) => {
    const { name } = ctx.client.info();

    if (ctx.client.supportsApps()) {
      // Rich widget for MCP Apps hosts (Claude, Goose, …)
      const data = await fetchData(query);
      return widget({ props: data, output: text(`Found ${data.length} items`) });
    }

    // Plain text fallback for all other clients
    return text(`Results for "${query}" (connected from ${name ?? "unknown client"})`);
  }
);
```

## Related Documentation

- [Client Capabilities — sampling.mdx](../../../../../../docs/typescript/server/sampling.mdx)
- [SEP-1865: MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps)
