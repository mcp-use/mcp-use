# Firebase MCP authentication

This example uses Firebase Google sign-in and Better Auth for MCP registration,
consent and tokens. Its `whoami` tool returns the verified identity and scopes.

## Setup

Use Node.js 22.22.2 or newer. From `libraries/typescript`, run `pnpm install`
and `pnpm build` to prepare the workspace packages.

1. Create a Firebase web app, enable the Google sign-in provider, and add your
   hostname to Authentication's authorized domains (including `localhost` for
   local development).
2. Save Firebase's public web app configuration as `firebase-config.json` in this
   directory, including `apiKey`, `authDomain`, `projectId`, and `appId`. The
   example accepts Google sign-ins with verified email from that project;
   tenant-scoped sign-ins are rejected.
3. Copy [`.env.example`](./.env.example) to `.env`. Generate `BETTER_AUTH_SECRET`
   with `openssl rand -hex 32` and keep it stable across restarts. Changing it can
   invalidate existing sessions. To use `BETTER_AUTH_SECRET_FILE`, remove the
   `BETTER_AUTH_SECRET` entry and set the file path instead.
4. Keep `SQLITE_FILE` for single-process local use, or set `DATABASE_URL` for
   PostgreSQL. This example requires `DATABASE_URL` when `NODE_ENV=production`.
5. Set `MCP_URL` to the server's public origin, without `/mcp`. The template uses
   `http://localhost:3038`; non-loopback origins require HTTPS.

From this directory:

```sh
pnpm migrate
pnpm dev
```

Connect an MCP client to `http://localhost:3038/mcp` (or your configured origin
plus `/mcp`) and complete sign-in and consent. For a compiled server, run
`pnpm build` followed by `pnpm start` after migration.

## Session behavior and limits

- Strict requests check Firebase account status. Detection of revocation or
  disablement depends on Firebase's responses. Browser sign-out alone does not
  revoke the retained Firebase refresh token.
- Temporary provider failures and timeouts return `503`. Automatic MCP client
  recovery from these responses remains unverified.
- Revoking a local MCP grant stops renewal, but an issued MCP access token can
  remain usable until expiry, up to five minutes with this configuration.
