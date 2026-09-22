---
"mcp-use": minor
---

Add mixed authentication to `MCPServer`: serve public, optional, and sign-in tools, resources, and prompts from one OAuth-enabled endpoint that works in Claude and ChatGPT.

- `mixedAuth: true` on the server lets anyone connect and list tools, resources, and prompts without a token. It requires an `oauth` provider and does not make anything public.
- A new `auth` field on tools, resources, resource templates, and prompts decides who can use each item: `"public"`, `"optional"`, `{ scopes }` (sign-in with extra scopes), or `{ scopes, optional: true }` (advertised only; the callback checks them). Omitting it means sign-in with the provider's `requiredScopes`.
- `ctx.auth` is typed per item from the literal `auth` value: required in sign-in items, possibly `undefined` in public and optional ones. The new `ToolAuth` type describes the values.
- Refused calls are answered before the callback runs, as HTTP `401`/`403` with `WWW-Authenticate` for Claude and spec clients, or as an `isError` tool result with `_meta["mcp/www_authenticate"]` for ChatGPT user agents. An invalid or expired token is always refused with `401`, even on public items.
- Tools advertise `securitySchemes` generated from `auth` on `tools/list`, at the top level and in `_meta.securitySchemes`. A hand-written `_meta.securitySchemes` on a tool without `auth` is now also copied to the top level; setting it next to `auth` or on a `mixedAuth` server throws at registration.
- `auth: { scopes }` also works without `mixedAuth`, adding those scopes to the endpoint-wide requirement.

The `mixed-oauth` example now uses this API instead of a hand-rolled gate, covers every `auth` value on tools, resources, templates, prompts, and views, and can run behind `mcp-use dev --tunnel` for testing in Claude and ChatGPT.
