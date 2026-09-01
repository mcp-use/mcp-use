# Lane OAuth Provider

This example is Lane's UCP index server (`ucp_find_merchants`,
`ucp_search_products`, `ucp_find_product`, `ucp_browse_merchant`,
`ucp_get_payment_url`, `lane_checkout`, `lane_checkout_status`) ported from
Lane's 1.34-era adapter to a regular `mcp-use` v2 server at
`http://localhost:43128/mcp`, authenticated and gated by
[Lane](https://www.getonlane.com).

Lane is a standard OAuth 2.1 authorization server: MCP clients register with it
through Dynamic Client Registration and complete the browser flow there. On top
of that, `oauthLaneProvider` installs Lane's consent gate: every tool above
refuses until the agent runs `lane_register_session`, which exchanges the
caller's token server-side and records a connection for that credential.

## Before you run it

Lane has to know about this server first.

1. Ask Lane to claim the exact public host you will serve from. Tokens are
   audienced to that host and refused everywhere else. `localhost` cannot be
   claimed, so use a tunnel hostname or a deployed URL and set `MCP_URL` to
   that origin.
2. Ask Lane for a confidential client (id and secret) with the token-exchange
   grant. It is used only by `lane_register_session`; clients registered
   through Lane's public registration endpoint cannot perform the exchange.
3. Have a Lane account to log in with.

## Run it

From this directory:

```sh
pnpm install
cp .env.example .env   # fill in MCP_URL and the client credentials
pnpm dev
```

Connect an OAuth-capable MCP client (or the Inspector at
`http://localhost:43128/mcp/inspector`) to your public `/mcp` URL. The browser
flow is sent to Lane. After login:

1. `lane_session_info` reports `connected: false`.
2. Any UCP tool returns the "Login incomplete" error result naming
   `lane_register_session`.
3. `lane_register_session` returns `{ ok: true, scopes: [...] }`.
4. The UCP tools work. `ucp_get_payment_url`, `lane_checkout`, and
   `lane_checkout_status` additionally require the `email` scope on the
   connection.

Gate decisions are printed to the console as `[gate] allowed|blocked ...`.
Set `LANE_ENFORCEMENT=log-only` to watch what would be blocked without
refusing anything.

## File layout

```text
src/index.ts       Regular MCPServer default export; registers the tools
src/ucp-tools.ts   The five UCP tool definitions (schemas, descriptions, run)
src/ucp.ts         UCP protocol client: catalog search, browse, checkout URL
src/lane-tools.ts  lane_checkout and lane_checkout_status definitions
src/lane-api.ts    Client for Lane's Order API (POST /agent/v1/orders)
```

`ucp.ts`, `ucp-tools.ts`, `lane-api.ts`, and `lane-tools.ts` are Lane's own
modules, unchanged apart from removing the Hono-specific bearer lookup; the
caller's bearer now comes from `ctx.auth.accessToken`.

## What the integration owns

- `oauthLaneProvider({ connections, scopes, enforcement, onGateEvent })`
  verifies Lane tokens (JWKS, strict audience, `at+jwt`, required `jti`) and
  installs the gate, `lane_register_session`, `lane_session_info`, the
  `lane://auth-guide` resource, the root-form
  `/.well-known/oauth-protected-resource` document, and the step-up
  instructions.
- `mcp-use dev` hosts the MCP resource server and the path-inserted
  protected-resource metadata.
- Lane owns login, consent, token issuance, the token exchange, and the
  Order API.

## Differences from Lane's 1.34 adapter

- mcp-use v2 requires a bearer for every MCP request, including `initialize`
  and `tools/list`. Lane's adapter answered those anonymously and returned 401
  only on `tools/call`; its `anonymousToolList` option has no equivalent here.
- Tokens audienced to Lane's canonical resource (`https://app-mcp.getonlane.com`)
  are not accepted. The token must name this server's `/mcp` URL.
- Enforcement supports `gate-all` and `log-only`. The adapter's fail-open
  `{ allow: [...] }` rollout mode and `lane/tags` tool annotations are not
  implemented; per-tool requirements come from the `scopes` map.
- Connections live in `memoryLaneConnectionStore()`, which is correct for one
  process. Multi-instance deployments need a shared `LaneConnectionStore`.
