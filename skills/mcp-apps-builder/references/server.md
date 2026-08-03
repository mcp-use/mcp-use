# Server primitives

## Package boundaries

- Server framework and helpers: `mcp-use`
- React View runtime: `mcp-use/react`
- OAuth core: `mcp-use/oauth`
- Provider adapters: `mcp-use/oauth/auth0`, `/clerk`, `/keycloak`, `/supabase`, `/workos`, and `/better-auth`
- Client and Agent packages: `@mcp-use/client` and `@mcp-use/agent`

The server entry must default-export its `MCPServer`. Use named exports for tool refs consumed by Views.

## Tools

Use `inputSchema` for arguments and `outputSchema` for structured results. The callback must return a protocol result, not a plain object.

```ts
export const lookup = server.tool(
  {
    name: "lookup",
    description: "Look up an item by id",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ id: z.string(), value: z.string() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ id }) => {
    const item = { id, value: "example" };
    return {
      content: [{ type: "text", text: JSON.stringify(item) }],
      structuredContent: item,
    };
  },
);
```

For an error, return `isError: true` with model-visible content. When an `outputSchema` exists, every non-error result must include matching `structuredContent`.

## Resources and prompts

Confirm definitions against installed types because their schema fields differ from tools. Resources expose read-only content by URI. Prompts return `messages`; their argument definition currently uses `schema`, not a tool's `inputSchema`.

Prefer raw protocol envelopes. Response helpers remain migration conveniences, but do not use them to recreate retired View/widget behavior.

## Middleware and request context

Use `server.use("mcp:...")` for MCP method middleware and `server.app` for Hono HTTP routes. Read authentication and request-scoped services from the callback context. Avoid module-level mutable user/session state: v2 requests may be sessionless and concurrent.

## Server configuration

Treat `MCP_URL` as a public origin. `basePath` owns the MCP endpoint path. Public assets resolve under `<basePath>/_mcp-use/public/`; use `MCP_ASSETS_URL` only when assets have a distinct origin or prefix.
