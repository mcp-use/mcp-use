---
"mcp-use": minor
---

Restore Hono as the server HTTP layer. Add typed custom routes and HTTP
middleware directly on `MCPServer`, expose `server.fetch` as the single
Web-standard serving boundary, and pass the active Hono context to MCP
callbacks with `request` plus the deprecated `req` alias.

Keep v1's `getHandler()` as a deprecated identity alias for `server.fetch`, but
remove its duplicate lifecycle and configuration path. `getNodeHandler()` is
not retained: Node's default path uses `server.listen()`, and custom Node
servers use `toNodeHandler({ fetch: server.fetch })` from `mcp-use/node`.
