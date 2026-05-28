# OpenAPI Server Example

This example creates an MCP server from a bundled OpenAPI document:

```ts
const server = MCPServer.fromOpenAPI({
  spec: openapiSpec,
  baseUrl: "http://localhost:3010/api",
});
```

The example also mounts a tiny REST API at `/api/todos` so the generated MCP
tools can be called immediately.

## Run

```sh
pnpm --filter openapi-server-example dev
```

Then connect with the CLI:

```sh
mcp-use client connect openapi-example http://localhost:3010/mcp --no-oauth
mcp-use client openapi-example tools list
mcp-use client openapi-example tools call getTodo id=todo-1
mcp-use client openapi-example tools call updateTodo id=todo-2 body:='{"completed":true}'
```
