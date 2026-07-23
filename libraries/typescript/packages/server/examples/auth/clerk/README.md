# Clerk direct-auth example

This example verifies Clerk-issued access tokens and exposes one authenticated
tool: `get-user-info`.

## Configure Clerk

1. Create or select an application in the [Clerk Dashboard](https://dashboard.clerk.com/).
2. Enable Clerk OAuth. Enable OpenID Connect if your client requires it.
3. Under **Configure** > **OAuth Applications**, enable Dynamic Client
   Registration so MCP clients can register directly with Clerk.
4. Copy your application's Frontend API URL from **Configure** > **API Keys**.

## Configure and run

Copy the example environment file and add your Clerk Frontend API URL:

```sh
cp .env.example .env
```

Set `CLERK_AUDIENCE` only when your Clerk access-token configuration uses an
audience. When omitted, the provider uses Clerk's issuer-bound access-token
model. In either mode, a token that carries an explicit RFC 8707 `resource`
claim must match the canonical MCP resource. For public and tunnel
deployments, set `MCP_URL` to the server origin, such as
`https://mcp.example.com`, not the `/mcp` endpoint. The CLI derives the
canonical protected resource as `https://mcp.example.com/mcp`.

Run the server:

```sh
pnpm dev
```

`mcp-use dev` owns the local socket and serves `server.fetch` from this
default-exported server. Before importing the entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin. The shared handler uses `legacy: "stateless"`. Public and
tunnel deployments require `MCP_URL`.

## How authentication works

This is direct mode. The MCP client discovers Clerk metadata, registers and
authenticates with Clerk, then calls this server with a Clerk access token.
The server verifies the token and exposes verified user, organization,
permissions, scope, client, expiry, and protected-resource metadata to
`get-user-info`.

Point an MCP client to `http://localhost:3000/mcp` for local development, or
to your deployment's `/mcp` endpoint.
