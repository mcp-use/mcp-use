# MCPBundles Connect Auth example

This example secures an `mcp-use` MCP server with **MCPBundles Connect Auth** on the
vendor **origin** path (Path A). It exposes one read-only tool, `get-user-info`, which
returns the verified Connect Auth identity plus token authorization metadata. It never
returns the bearer token.

Clients can also connect through the MCPBundles bundle proxy at
`https://mcp.mcpbundles.com/bundle/{slug}` (Path B) without running this provider on
their server.

## Configure MCPBundles

1. Publish your MCP server on MCPBundles with **Connect Auth** enabled.
2. Set your federation sign-in URL and save the federation secret on your **web app**
   (not in this MCP server).
3. Copy your listing slug into a local `.env` file:

```sh
cp .env.example .env
```

```dotenv
MCPBUNDLES_LISTING_SLUG=your-listing-slug
# MCP_URL=https://mcp.example.com
```

For a public deployment, set `MCP_URL` to the public MCP server origin as shown above.

See the [MCP Connect Auth integration guide](https://www.mcpbundles.com/docs/integrations/mcp-connect-auth)
for maintainer dashboard steps and federation setup.

## Run it

From this directory:

```sh
pnpm dev
```

`mcp-use dev` owns the local socket and serves `server.fetch` from this
default-exported server. Before importing the entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin.

## Authentication flow

The MCP client discovers the tenant authorization server through protected-resource
metadata served by this MCP server. It registers through DCR, authenticates the user
with MCPBundles Connect Auth, and obtains an ES256 access token. This server verifies
the token against the tenant JWKS before `get-user-info` runs.

```text
MCP client ── discovery / registration / sign-in ──> MCPBundles tenant AS
MCP client ── verified bearer-token tool call ──────> this MCP server
```

## Typecheck

```sh
pnpm typecheck
```
