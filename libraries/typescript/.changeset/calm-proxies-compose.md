---
"mcp-use": minor
---

Add `MCPServer.proxy()` for composing multiple upstream MCP servers through the
optional `@mcp-use/client` v2 peer. Config-map connections are namespaced and
server-owned; ready `MCPConnection` instances can also be mounted directly.
