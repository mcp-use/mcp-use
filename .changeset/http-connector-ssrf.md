---
"mcp-use": patch
---

Validate MCP connection URLs in the HTTP connector. The `baseUrl` (and gateway URL) are now checked to be well formed and to use the `http`/`https` scheme before any request is made, rejecting SSRF vectors such as `file:`, `gopher:` and `data:` URLs. Loopback and private hosts (`http://localhost`, `http://127.0.0.1`, ...) remain allowed, since connecting to a local or LAN MCP server is a common, legitimate use case.
