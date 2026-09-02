---
"mcp-use": minor
---

Add an optional `setup(host)` hook to `OAuthProvider`. Providers can install MCP middleware, provider-owned tools and resources, additional public discovery routes, and `initialize` instructions while the server mounts. The `OAuthProviderHost` type is exported from `mcp-use/oauth`.
