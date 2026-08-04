---
"@mcp-use/tunnel": minor
"@mcp-use/cli": patch
"mcp-use": patch
---

Move the tested WebSocket tunnel manager into the new
`@mcp-use/tunnel` workspace package. The standalone `mcp-tunnel` command and
the built-in `mcp-use dev/start --tunnel` flows now share one implementation.
The CLI embeds that implementation at build time, so installing `mcp-use` does
not add `@mcp-use/tunnel` as a separate runtime dependency.
