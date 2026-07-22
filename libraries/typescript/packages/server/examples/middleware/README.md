# Request-aware MCP middleware

This server demonstrates two layers:

- `mcp:tools/list` reads `ctx.request.header()` and rejects discovery unless the
  client sends `x-example-access: allow`.
- `mcp:tools/call` records request-local state before an `echo` call reaches
  its tool handler.

MCP middleware combines the parsed operation with the originating Hono context.
Use `server.use("*", honoMiddleware)` for routes or policy that must run before
MCP parsing; values set with `c.set()` are available through `ctx.get()`.

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
