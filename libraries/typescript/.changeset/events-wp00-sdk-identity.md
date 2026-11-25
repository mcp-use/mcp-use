---
"mcp-use": patch
"@mcp-use/cli": patch
---

Record the official MCP SDK version and source hash compiled into each build in `dist/sdk-info.json`, and pin `@modelcontextprotocol/{client,core,server}` through one shared pnpm catalog so every package resolves the same SDK.
