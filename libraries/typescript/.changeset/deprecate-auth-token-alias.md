---
"@mcp-use/agent": patch
"@mcp-use/inspector": patch
---

Mark the `auth_token` alias deprecated on both `MCPServerConfig` types. v2 renamed it to `authToken` and nothing has read the snake-case spelling since, so setting it produces no `Authorization` header. The field stays for now so existing TypeScript consumers keep compiling, and editors flag it at the call site instead. Removal waits for the next major.
