# `@mcp-use/tunnel`

WebSocket tunnel client for exposing a local HTTP or MCP server through the
managed mcp-use relay.

```bash
npx @mcp-use/tunnel 3000
```

The package is also the tunnel implementation used by `mcp-use dev --tunnel`
and `mcp-use start --tunnel`.

## Options

```text
mcp-tunnel <LOCAL_PORT> [--relay RELAY_URL] [--subdomain SUBDOMAIN]
```

Set `MCP_USE_WS_RELAY` to override the production relay API origin. Tunnel
reservations are authenticated, persisted in `.mcp-use/state/tunnel.json`, and
released during graceful shutdown.

The client forwards HTTP responses incrementally and supports public WebSocket
upgrades using the relay's bounded binary framing protocol.
