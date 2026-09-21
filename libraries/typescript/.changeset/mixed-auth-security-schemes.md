---
"mcp-use": minor
---

Add mixed authentication to `MCPServer`: serve public and protected tools from one OAuth-enabled endpoint.

- `allowAnonymous: true` on the server config lets `initialize`, list requests, and public tool calls run without a bearer token while every other request stays protected.
- `securitySchemes` on a tool definition is the single source of truth for enforcement and for the metadata emitted on `tools/list` (top-level `securitySchemes` and `_meta.securitySchemes`). `[{ type: "noauth" }]` makes a tool public, `[{ type: "oauth2", scopes }]` requires those scopes plus the provider's `requiredScopes`, and declaring both makes authentication optional with `ctx.auth` populated when a token is present. Tools without a declaration stay protected.
- `authErrorMessage` on a tool customizes the challenge text; `authChallenge` on the server selects the representation (`"http"` for the spec's `401`/`403` with `WWW-Authenticate`, `"tool-result"` for ChatGPT's `isError` result carrying `_meta["mcp/www_authenticate"]`, or the default `"auto"` User-Agent match).
- Callbacks on an `allowAnonymous` server receive an optional `ctx.auth`; the new `OAuthMode` type describes the three modes.
- Tool-level `oauth2` scopes are also enforced on servers without `allowAnonymous`, adding to the provider baseline.

The `mixed-oauth` example now uses this API instead of a hand-rolled gate.
