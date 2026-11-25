# MCP event observers

This server observes `mcp:tools/list` before dispatch and with the
`:complete` suffix after its result is available. Observers are read-only:
they cannot block or alter the response. They can inspect `ctx.request` to
correlate an MCP operation with an HTTP request header.

```sh
pnpm dev
```

Connect to `http://localhost:3000/mcp`, list tools, then read
`events://observations` or call `recent-events`. The output includes
`tools/list:before`, the supplied request ID, and `tools/list:complete`.

```sh
pnpm verify
```
