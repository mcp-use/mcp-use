---
"mcp-use": minor
---

Add `MCPServer.proxy()` for composing multiple upstream MCP servers through the
optional `@mcp-use/client` v2 peer. HTTP upstreams are automatically namespaced
and registered best-effort, authenticated connections use caller-managed bearer
tokens or headers without browser OAuth, and ready `MCPConnection` instances can
also be mounted with their negotiated server name as the namespace.
