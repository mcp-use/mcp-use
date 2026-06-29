---
"mcp-use": minor
---

Add tool-level authentication metadata via `securitySchemes` (SEP-1488 / OpenAI Apps SDK).

Tools can now declare their auth policy on registration with `securitySchemes: [{ type: "noauth" }, { type: "oauth2", scopes: [...] }]`. The value is emitted as a top-level field on each `Tool` in the `tools/list` response so ChatGPT-style clients surface the correct sign-in UI. A server-wide `defaultSecuritySchemes` option on `MCPServer` covers tools that don't declare their own.

Pair with the new `authenticationRequired()` response helper to emit `_meta["mcp/www_authenticate"]` Bearer challenges from a tool handler when an unauthenticated caller hits an auth-gated path.

When at least one tool advertises `{ type: "noauth" }`, the bearer-auth middleware on `/mcp/*` automatically switches to optional mode: requests without an `Authorization` header are allowed through with no `ctx.auth` (so ChatGPT can run `initialize`/`tools/list` and call public tools before signing in), while invalid tokens are still rejected with 401. Servers without `securitySchemes` keep the existing strict behavior — no breaking change.
