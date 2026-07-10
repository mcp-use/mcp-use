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

- `SUPABASE_PROJECT_ID` — the project reference, such as `abcd1234`
- `SUPABASE_URL` — the full project URL, such as
  `https://abcd1234.supabase.co`

Also set:

- `SUPABASE_PUBLISHABLE_KEY` — the publishable key (`sb_publishable_...`) from
  Project Settings → API Keys. Required by the consent UI.

`SUPABASE_JWT_SECRET` is optional and only needed for legacy HS256 Supabase
JWTs. If set, it must be at least 32 bytes. Without it, this example verifies
ES256 tokens using the project's Supabase JWKS endpoint.

For a deployed server, set `MCP_URL` to its public origin, for example
`https://mcp.example.com`. The framework derives the protected resource URL as
`https://mcp.example.com/mcp`, advertises resource metadata there, and checks a
token's resource binding when the token carries one.

## Consent flow

[Supabase's OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server)
requires the application to host its own authorization/consent UI. In the
Supabase dashboard (Authentication → OAuth Server), set
`authorization_url_path` to `/auth/consent` so it matches the path this example
serves.

When a user needs to approve an OAuth client, Supabase redirects their browser
to that path with `?authorization_id=<uuid>`. This example mounts the consent
routes via the `configureApp` config option (public routes, not behind the
OAuth bearer gate):

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

`mcp-use dev` owns the local socket and calls `getHandler()` on this
default-exported server. Before importing the entry, it resolves the actual
local port and, when `MCP_URL` is absent, supplies a scoped trusted local
canonical origin. The shared handler uses `legacy: "stateless"`. Public and
tunnel deployments require `MCP_URL`.

## Typecheck

```sh
pnpm typecheck
```
