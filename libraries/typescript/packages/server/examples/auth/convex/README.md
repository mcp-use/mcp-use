# Convex OAuth Provider

This example runs a regular `mcp-use` server at `http://localhost:43127/mcp`
and verifies access tokens issued by an external Convex OAuth Provider
deployment.

The MCP server only receives `authURL` and verifies JWTs against Convex's
JWKS. Convex owns discovery, dynamic client registration (when enabled),
login, consent, and token issuance.

## Run it

From this directory:

```sh
pnpm install
pnpm dev
```

Connect an OAuth-capable MCP client (or the Inspector at
`http://localhost:43127/mcp/inspector`) to `http://localhost:43127/mcp`. The
browser flow is sent to your Convex deployment. After approval, the `whoami`
tool returns the verified Convex subject.

By default this example points at:

```text
https://helpful-sturgeon-388.convex.site/oauth
```

Override with `MCP_USE_OAUTH_CONVEX_AUTH_URL` if needed. Copy `.env.example` to
`.env` for local overrides. For public or tunnel deployments, set `MCP_URL` to
the MCP server origin (not the `/mcp` path).

Enable Dynamic Client Registration on the Convex OAuth component so MCP
clients can register against the advertised `registration_endpoint`. Set the
Inspector **Scope** to `openid profile email` if the client does not send a
scope by default.

## File layout

```text
src/index.ts  Regular MCPServer default export used by mcp-use dev
```

## What the integration owns

- `oauthConvexProvider({ authURL })` advertises Convex endpoints and verifies
  its access-token JWTs.
- `mcp-use dev` hosts only the MCP resource server and its protected-resource
  metadata.
- Your Convex deployment remains responsible for the OAuth provider component,
  persistence, login, consent UX, and DCR.
