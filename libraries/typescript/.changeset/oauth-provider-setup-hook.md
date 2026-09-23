---
"mcp-use": minor
---

Add an optional `setup(host)` hook to `oauthCustomProvider`. The server runs it once while mounting, so a provider can install `mcp:` middleware, register provider-owned tools, resources, resource templates, and prompts with methods that mirror the server's, validate the application's tools with `listTools()`, and rewrite the advertised instructions. `host.mixedAuth` reports whether the server accepts signed-out clients, and provider tools accept `securitySchemes` like `server.tool()`. The `OAuthProviderHost<TUser>` type is exported from `mcp-use/oauth`.
