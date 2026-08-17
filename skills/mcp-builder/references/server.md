# Server

## Project and lifecycle

Import `MCPServer` from `mcp-use`. Default-export the server entry so `mcp-use dev`, `mcp-use build`, and `mcp-use start` can own the listener and View pipeline. Call `server.listen()` only in an explicitly standalone program.

Use the project's package manager and existing scripts. For a new stable project, scaffold instead of recreating framework boilerplate:

```bash
npx create-mcp-use-app@latest my-server --template mcp-server
```

## Tools

Use a Standard Schema-compatible validator such as Zod, ArkType, or Valibot. Describe fields when the description helps a client or model choose valid input.

```ts
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({ name: "inventory", version: "1.0.0" });

export const lookupInventory = server.tool(
  {
    name: "lookup-inventory",
    description: "Return available inventory for one SKU",
    inputSchema: z.object({ sku: z.string().describe("Inventory SKU") }),
    outputSchema: z.object({ sku: z.string(), available: z.number().int() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ sku }) => {
    const data = { sku, available: await inventory.count(sku) };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  },
);

export default server;
```

Use `visibility: "app"` for helper tools intended for Views but hidden from the model. Treat annotations as behavioral hints, not authorization controls.

## Result channels

- Put concise model-readable output in `content`.
- Put schema-validated JSON in `structuredContent` when `outputSchema` exists.
- Put invocation-specific, View-only data in result `_meta`; validate or narrow it in the View.
- Return `isError: true` with useful `content` for expected operational failures.
- Throw only for unexpected failures that should surface as protocol errors.

## Resources and prompts

Use `server.resource()` for one stable URI and `server.resourceTemplate()` for a URI family. Return `{ contents: [...] }`; each entry must include its URI and either text or a base64 blob. A template callback receives `(uri, params, ctx)`, and template values may be `string | string[]`.

Use `server.prompt()` for model-ready messages. Prompt arguments use `schema`, not a tool's `inputSchema`, and the callback returns `{ messages: [...] }`. Wrap a string field with `completable()` when clients should receive suggestions without restricting other valid strings.

## MCP middleware and request context

Register protocol middleware with `server.use("mcp:<method>", handler)`. Use the narrowest operation, call `next()`, and return its result unless intentionally replacing it.

```ts
server.use("mcp:tools/call", async (ctx, next) => {
  const startedAt = Date.now();
  const result = await next();
  console.log(`${ctx.params.name}: ${Date.now() - startedAt}ms`);
  return result;
});
```

Tool, resource, and prompt callbacks receive request-scoped context. Use `ctx.signal` for cancellation, `ctx.client` for self-reported capabilities, and `ctx.auth` only when OAuth is configured. Never use client metadata for authorization.

Register static capabilities while constructing the server. Use the notification helpers described in [Advanced features](advanced-features.md) when discoverable lists or resource content change.
