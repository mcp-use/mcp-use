---
"mcp-use": minor
"@mcp-use/cli": minor
---

feat(auth): Node OAuth client provider + CLI OAuth flow

Adds a real OAuth flow to the `mcp-use` CLI. `mcp-use client connect <url>`
against an OAuth-protected MCP server now opens a browser, captures the
authorization code via a localhost loopback, persists tokens to
`~/.mcp-use/oauth/<urlHash>/`, and silently refreshes them on subsequent
commands — no flag plumbing.

New on `mcp-use`:

- `mcp-use/auth/node` entrypoint exporting `NodeOAuthClientProvider`,
  `FileKVStore`, the `KVStore` type, and re-exporting the SDK's `auth` and
  `UnauthorizedError`.
- `NodeOAuthClientProvider` implements `OAuthClientProvider`, owns the
  loopback callback server (preferred port 33418, walks up to 33427 on
  conflict, persisted across runs), and exposes `getAuthorizationCode()`
  for the orchestrator pattern in `useMcp.ts`.
- `FileKVStore` writes tokens, client info, and code verifiers to one file
  per key under `~/.mcp-use/oauth/<urlHash>/` with `0o600` perms and atomic
  rename on write.

New on `@mcp-use/cli`:

- `mcp-use client connect <url>` auto-runs OAuth on `UnauthorizedError`
  when no `--auth` is supplied. New flags: `--no-oauth`, `--auth-timeout`.
- `mcp-use client auth status|refresh|logout [session]` for token
  introspection, forced refresh, and revocation. (No `auth login` — that's
  what `connect` is for.)
- Follow-up commands (`tools list`, etc.) on OAuth sessions transparently
  refresh expiring JWTs. If the refresh token itself is dead, the CLI
  prompts to re-auth on TTY or prints the exact `connect` command to run
  on non-TTY.
