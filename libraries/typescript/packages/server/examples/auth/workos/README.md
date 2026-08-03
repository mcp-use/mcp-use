# WorkOS AuthKit example

This example secures an `mcp-use` MCP endpoint with WorkOS AuthKit.
It exposes one read-only tool, `get-user-info`, which returns the verified
WorkOS user identity plus the token's authorization metadata. It never returns
the bearer token.

## Configure AuthKit

Create an AuthKit configuration in the [WorkOS dashboard](https://dashboard.workos.com)
and enable Dynamic Client Registration (DCR). DCR lets MCP clients register
their own OAuth client during authorization.

Set the AuthKit subdomain in a local `.env` file:

```sh
cp .env.example .env
```

```dotenv
WORKOS_SUBDOMAIN=your-company.authkit.app
# WORKOS_AUDIENCE=https://api.example.com
```

`WORKOS_SUBDOMAIN` may be either the AuthKit hostname or its HTTPS origin.
Set `WORKOS_AUDIENCE` only when your AuthKit access tokens have a required
audience. For a public deployment, set `MCP_URL` to the public MCP server
origin as shown in `.env.example`.

## Run it

From this directory:

```sh
pnpm dev
```

`mcp-use dev` owns the local socket and serves `server.fetch` from this
default-exported server. Before importing the entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin. The shared handler uses `legacy: "stateless"`. Public and
tunnel deployments must set `MCP_URL` to the server origin.

## Authentication flow

The MCP client uses the server's protected-resource metadata to discover
WorkOS AuthKit. It registers through DCR, authenticates the user with WorkOS,
and obtains an access token directly from WorkOS. It then calls this MCP
server with that token; the WorkOS provider verifies its signature and claims
using AuthKit's JWKS before `get-user-info` runs.

```text
MCP client ── discovery / registration / sign-in ──> WorkOS AuthKit
MCP client ── verified bearer-token tool call ──────> this MCP server
```

## Typecheck

```sh
pnpm typecheck
```
