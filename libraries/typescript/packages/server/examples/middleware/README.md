# Request-aware MCP middleware

This server demonstrates two layers:

- `mcp:tools/list` reads `ctx.request.headers` and rejects discovery unless the
  client sends `x-example-access: allow`.
- `mcp:tools/call` records request-local state before an `echo` call reaches
  its tool handler.

MCP middleware combines the parsed operation with the originating HTTP request.
Use framework middleware around `server.getHandler()` only for routes or policy
that must run before MCP parsing.

```sh
pnpm dev
```

Connect to `http://localhost:3000/mcp` with the required header; list tools,
then call `echo` with a `message`. A tools-list request without the header is
rejected as an MCP error. The returned text confirms that the call also passed
through MCP middleware.

```sh
pnpm verify
```
