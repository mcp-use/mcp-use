# GitHub OAuth Proxy example

This server lets MCP clients authenticate through one GitHub OAuth App. The
server performs the GitHub authorization flow, stores GitHub tokens privately,
and issues separate opaque tokens to each MCP client.

## Configure GitHub

1. Create a GitHub OAuth App under **Settings → Developer settings → OAuth
   Apps**. GitHub documents the endpoints, S256 PKCE fields, and code exchange
   in [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
2. Set **Homepage URL** to `http://localhost:3000`.
3. Set **Authorization callback URL** to
   `http://localhost:3000/oauth/callback`.
4. Copy `.env.example` to `.env` and set `GITHUB_CLIENT_ID` and
   `GITHUB_CLIENT_SECRET`.

For a public deployment, use the public origin for the homepage and register
`https://mcp.example.com/oauth/callback`. Set `MCP_URL` to that origin without a
path.

## Run

From this directory:

```sh
pnpm dev
```

The script requests port 3000. If the CLI selects another available port,
update the GitHub OAuth App callback URL to match the printed origin and restart
the authorization flow.

Connect an MCP client to `http://localhost:3000/mcp`. The server dynamically
registers the MCP client locally and asks for consent before redirecting to
GitHub.

## Verify the token boundary

Call the `get-github-user` tool after authorization. The tool uses
`ctx.auth.providerAccessToken` to call GitHub. `ctx.auth.accessToken` is the
separate opaque token presented by the MCP client and must not be sent to
GitHub.

The default store is process-local. Restarting the server clears client
registrations, consent transactions, and token sessions.

## Verify types

```sh
pnpm typecheck
```
