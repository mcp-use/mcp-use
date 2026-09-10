---
"@mcp-use/agent": minor
"@mcp-use/inspector": minor
---

Remove the dead `auth_token` alias from both `MCPServerConfig` types. v2 renamed it to `authToken` and nothing has read the snake-case spelling since, so declaring it advertised an option that silently produced no `Authorization` header. Removing a field from an exported type is a type-level break for anyone who still sets it, even though its runtime behaviour was already nothing.
