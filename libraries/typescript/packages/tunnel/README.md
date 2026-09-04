# `@mcp-use/tunnel`

Expose a local HTTP, WebSocket, or MCP server through the managed mcp-use
WebSocket relay.

```bash
npx @mcp-use/tunnel 3000
```

The same client powers `mcp-use dev --tunnel` and
`mcp-use start --tunnel`; installing `mcp-use` does not install this package
separately.

## Options

```text
mcp-tunnel <LOCAL_PORT> [--relay RELAY_URL] [--subdomain SUBDOMAIN]
```

Set `MCP_USE_WS_RELAY` to use another relay origin. Reservations are
authenticated, persisted in `.mcp-use/state/tunnel.json`, and released during
graceful shutdown.
