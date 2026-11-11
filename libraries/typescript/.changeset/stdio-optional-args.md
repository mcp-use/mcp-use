---
"@mcp-use/client": patch
---

Start a stdio server whose config has a `command` and no `args`. `MCPClient` used to reject that config with "Cannot determine connector type from config" even though `StdioConnector` already defaults `args` to an empty list.
