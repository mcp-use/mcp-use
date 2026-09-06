---
"@mcp-use/agent": patch
---

Fix `auth_token` in `mcpServers` being ignored. `MCPServerConfig` advertises the legacy snake-case spelling for configurations shared with the Python SDK, but the config object was handed to `@mcp-use/client` unchanged and the client only reads `authToken`, so those servers connected with no `Authorization` header and no warning.
