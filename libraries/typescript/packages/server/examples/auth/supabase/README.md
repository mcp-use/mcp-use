# Supabase direct-auth example

This server is an OAuth-protected MCP resource server. It verifies Supabase
access tokens sent by the MCP client directly; it does not implement a full
OAuth authorization server. Supabase hosts `/authorize`, `/token`, `/register`,
and discovery — this example hosts the consent UI that Supabase's OAuth 2.1
server requires.

It exposes one read-only tool:

- `get-user-info()` returns verified Supabase identity fields (`id`, `email`,
  `name`, `fullName`, `username`, `avatarUrl`, `role`, `aal`, `amr`, and
  `sessionId`) plus verified authorization metadata (`permissions`, `scopes`,
  `expiresAt`, and, when present, `clientId` and `resource`). It never returns
  the access token.

## Configure Supabase

Copy `.env.example` to `.env` and configure one of:

- `MCP_USE_OAUTH_SUPABASE_PROJECT_ID` — the project reference, such as
  `abcd1234`
- `MCP_USE_OAUTH_SUPABASE_URL` — the full project URL, such as
  `https://abcd1234.supabase.co`

Also set:

- `MCP_USE_OAUTH_SUPABASE_PUBLISHABLE_KEY` — the publishable key
  (`sb_publishable_...`) from Project Settings → API Keys. Required by the
  consent UI.

`MCP_USE_OAUTH_SUPABASE_JWT_SECRET` is optional and only needed for legacy
HS256 Supabase JWTs. If set, it must be at least 32 bytes. Without it, this
example verifies ES256 tokens using the project's Supabase JWKS endpoint.

For a deployed server, set `MCP_URL` to its public origin, for example
`https://mcp.example.com`. The framework derives the protected resource URL as
`https://mcp.example.com/mcp`, advertises resource metadata there, and checks a
token's resource binding when the token carries one.

## Consent flow

[Supabase's OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server)
requires the application to host its own authorization/consent UI. In the
Supabase dashboard (Authentication → OAuth Server), set Authorization Path to
`/auth/consent` so it matches the path this example serves (the same setting is
`authorization_url_path` in CLI `config.toml`).

When a user needs to approve an OAuth client, Supabase redirects their browser
to that path with `?authorization_id=<uuid>`. This example mounts the consent
routes on a user-owned fetch-native app in front of the MCP handler (public routes, not
behind the OAuth bearer gate):

- `GET /auth/consent` — sign-in page if unauthenticated; otherwise consent UI
- `POST /auth/signin` — anonymous sign-in (demo only); stores a short-lived
  session cookie
- `POST /auth/consent` — approve or deny, then return the redirect URL

Anonymous sign-in is demo-only. Enable it in the Supabase dashboard under
Auth → Providers → Anonymous. For production, replace it with email/password,
magic links, or an OAuth provider.

## Run locally

```sh
pnpm dev
```

`pnpm dev` runs `tsx watch` on a standalone entry that owns the socket. That
entry composes a fetch-native app (Hono in this example) with the consent routes and the MCP handler
(`getHandler()`) on one port. When `MCP_URL` is absent, it defaults to
`http://localhost:3000` (or the configured `PORT`) so OAuth resource metadata
resolves locally. Public and tunnel deployments require `MCP_URL`. The shared
handler uses `legacy: "stateless"`.

## Typecheck

```sh
pnpm typecheck
```
