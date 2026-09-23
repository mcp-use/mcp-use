---
"mcp-use": minor
---

Add mixed authentication to `MCPServer`: serve public, optional, and sign-in tools from one OAuth-enabled endpoint that works in Claude and ChatGPT.

- `mixedAuth: true` on the server lets anyone connect and list tools, resources, and prompts without a token. It requires an `oauth` provider and does not make anything public.
- A new `securitySchemes` field on tools decides who can call each tool, using the shape ChatGPT reads on `tools/list`: `[{ type: "noauth" }]` (public), `[{ type: "noauth" }, { type: "oauth2", scopes }]` (optional; the scopes are advertised and the callback checks them), or `[{ type: "oauth2", scopes }]` (sign-in with extra scopes). Omitting it means sign-in with the provider's `requiredScopes`. The new `ToolSecurityScheme` type describes the entries.
- Resources, resource templates, and prompts always require sign-in with the provider's `requiredScopes`. Every tool's view loads signed out on a `mixedAuth` server, because ChatGPT reads the views while creating an app, before anyone signs in; the tool results stay gated.
- A tool's `ctx.auth` is typed from its literal `securitySchemes`: required when the tool needs sign-in, possibly `undefined` when it accepts `noauth`.
- Refused calls are answered before the callback runs, as HTTP `401`/`403` with `WWW-Authenticate` for Claude and spec clients, or as an `isError` tool result with `_meta["mcp/www_authenticate"]` for ChatGPT user agents. An invalid or expired token is always refused with `401`, even on public tools.
- Tools advertise their resolved `securitySchemes` on `tools/list`, at the top level and in `_meta.securitySchemes`. A hand-written `_meta.securitySchemes` is still passed through unchanged and never enforced; mcp-use warns when it sits on a `mixedAuth` server or differs from a declared `securitySchemes`.
- `oauth2` scopes also work without `mixedAuth`, adding those scopes to the endpoint-wide requirement.

The `mixed-oauth` example now uses this API instead of a hand-rolled gate, covers every `securitySchemes` shape, sign-in resources and prompts, and views, and can run behind `mcp-use dev --tunnel` for testing in Claude and ChatGPT.
