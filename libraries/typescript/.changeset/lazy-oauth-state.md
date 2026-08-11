---
"@mcp-use/client": patch
"@mcp-use/cli": patch
---

Defer automatic OAuth provider creation until an HTTP server returns 401, avoiding OAuth state writes for public MCP connections while preserving automatic authentication for protected servers.
