---
"mcp-use": patch
---

Fix an authentication bypass on OAuth-protected MCP servers. The MCP JSON-RPC handler is mounted on both `/mcp` and `/sse`, but the bearer-auth middleware was only applied to `/mcp/*`, leaving `/sse` reachable without a token. The middleware now also covers `/sse` (and `/sse/*`), and the server advertises RFC 9728 path-scoped protected-resource metadata for `/sse`.
