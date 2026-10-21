---
"@mcp-use/analytics": minor
---

Add `@mcp-use/analytics`: one `instrument(server)` call records an event per JSON-RPC request of an MCP server you host yourself and sends it to Manufact in the background (`MANUFACT_ANALYTICS_KEY`). Supports the official SDK v1 and v2 (`McpServer` and `Server`), Skybridge, Vercel's `mcp-handler` and mcp-use's `MCPServer`, on Node 18+, Bun, Deno, Cloudflare Workers and Vercel, with no runtime dependencies.
