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
pnpm dev
```
