# Better Auth + Hono

This example runs two independent applications:

- a regular `mcp-use` server at `http://localhost:43127/mcp`
- a Hono authorization server running Better Auth at
  `http://localhost:61843/api/auth`

The MCP server only receives `authURL` and verifies the access tokens issued by
the separate authorization server. The Hono app owns Better Auth, discovery,
dynamic client registration, anonymous sign-in, consent, and token issuance.

Better Auth is intentionally configured without a database. That enables its
stateless cookie-session mode and uses its in-memory adapter for anonymous
users, dynamically registered OAuth clients, authorization codes, and consent.
Everything resets when the auth process restarts, which is convenient for this
demo but not appropriate for a multi-instance or persistent deployment.

## Run it

Start the authorization server in one terminal:

```sh
pnpm dev:auth
```

Start the normal `mcp-use` development server in another:

```sh
pnpm dev
```

Connect an OAuth-capable MCP client to `http://localhost:43127/mcp`. The browser
flow is sent to the Hono app on port 61843, where it asks you to continue
anonymously and approve access. The MCP server's `whoami` tool then returns the
verified Better Auth subject.

`BETTER_AUTH_SECRET` is optional for local use. Copy `.env.example` to `.env`
and replace the secret before adapting the example for a deployment. Keep
`BETTER_AUTH_URL` and `MCP_USE_OAUTH_BETTER_AUTH_URL` identical, and set
`MCP_URL` to the MCP server's public origin. The auth process appends `/mcp`
for the token audience, matching the `mcp-use` CLI convention.

## File layout

```text
src/index.ts        Regular MCPServer default export used by mcp-use dev
src/auth-server.ts  Standalone Hono authorization server and login/consent UI
src/auth.ts         Better Auth configuration
```

## What the integration owns

- `oauthBetterAuthProvider({ authURL })` advertises the external Better Auth
  endpoints and verifies its access-token JWTs.
- `mcp-use dev` hosts only the MCP resource server and its protected-resource
  metadata.
- The separate Hono process mounts Better Auth and its authorization-server
  discovery routes.
- Your application remains responsible for Better Auth plugins, persistence,
  login, consent UX, and cross-origin policy.
